// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DecentralizedLottery
 * @notice Provably fair 7-ball lottery (1–49) powered by Chainlink VRF.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. Players buy tickets by choosing 7 unique numbers (1–49) in strictly
 *    ascending order before the 5-minute round ends.
 * 2. Anyone may call triggerDraw() once the round has elapsed. This
 *    requests verifiable randomness from Chainlink VRF and immediately
 *    opens the next round, so buying never stops.
 * 3. Chainlink delivers 7 random words. The contract uses Fisher-Yates
 *    to pick 7 unique numbers from [1,49] then sorts them ascending.
 * 4. Anyone calls countRoundWinners() then distributeRound() (in batches
 *    if needed) to process prizes without hitting block gas limits.
 * 5. Winners call withdrawPrize() to claim their ETH.
 *
 * PRIZE TABLE  (% of prize pool, split equally among tier winners)
 * ──────────────────────────────────────────────────────────────────
 *  Matches │  1  │  2  │  3   │  4   │  5   │  6   │  7
 *  Prize   │  0% │  5% │ 10%  │ 15%  │ 20%  │ 20%  │ 30%
 *
 * - Unused tier prizes (no winners) carry over to the next round's pool.
 * - Rounding dust also carries over.
 * - Owner earns 10% of every ticket price, withdrawable at any time.
 * - Rounds advance on a fixed 5-minute clock, never waiting for players.
 *
 * SECURITY
 * ─────────
 * - Chainlink VRF: randomness is cryptographically provable and cannot
 *   be manipulated by miners, players, or the contract owner.
 * - Ticket purchase is locked once triggerDraw() is called, eliminating
 *   front-running of winning numbers.
 * - Pull-payment pattern prevents reentrancy in prize withdrawals.
 * - ReentrancyGuard on all ETH-moving functions.
 * - Integer arithmetic in Solidity 0.8.x (built-in overflow checks).
 * - Owner has zero ability to alter draw results or prize math.
 */
contract DecentralizedLottery is VRFConsumerBaseV2, ReentrancyGuard, Ownable {

    //  CHAINLINK VRF

    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    uint64  private immutable i_subscriptionId;
    bytes32 private immutable i_gasLane;

    uint32  private constant CALLBACK_GAS_LIMIT    = 400_000;
    uint16  private constant REQUEST_CONFIRMATIONS  = 3;
    uint32  private constant NUM_WORDS              = 7;

    //  LOTTERY CONSTANTS

    uint256 public constant ROUND_DURATION = 5 minutes;
    uint256 public constant TICKET_PRICE   = 0.01 ether;

    /// @dev Owner cut in basis points (1000 = 10%).
    uint256 public constant OWNER_FEE_BPS  = 1_000;
    uint256 private constant BPS_DENOM     = 10_000;

    uint8 public constant BALLS     = 7;
    uint8 public constant MAX_BALL  = 49;

    /**
     * @dev Prize allocation per number of matches (index = match count).
     *      Values are in basis points (500 = 5%).
     *      Indices 0 and 1 award 0% (left in carry-over).
     *      Indices 2-7 sum to 10 000 (100% of the prize pool).
     */
    uint256[8] private PRIZE_BPS = [
        0,      // 0 matches → 0%
        0,      // 1 match   → 0%
        500,    // 2 matches → 5%
        1_000,  // 3 matches → 10%
        1_500,  // 4 matches → 15%
        2_000,  // 5 matches → 20%
        2_000,  // 6 matches → 20%
        3_000   // 7 matches → 30%
    ];

    //  DATA STRUCTURES

    struct Ticket {
        address player;
        uint8[7] numbers; // strictly ascending, 1–49
    }

    struct Round {
        uint256 startTime;
        uint256 endTime;
        /// @dev 90% of ticket sales + any carry-in from the previous round.
        uint256 prizePool;
        uint256 carriedIn;

        // ── draw result ──
        uint8[7] winningNumbers;
        bool drawRequested;
        bool drawCompleted;

        // ── Phase 1: count winners per tier ──
        uint256   countIdx;
        bool      countDone;
        uint256[8] tierCounts;      // number of winning tickets per match tier

        // ── Phase 2: distribute prizes ──
        uint256[8] tierPrizePerWinner; // ETH awarded to each winner in a tier
        uint256    distributeIdx;
        bool       distributeDone;

        /// @dev ETH that rolls into the next round (unused tiers + dust).
        uint256 carryOut;
    }

    //  STATE

    uint256 public currentRoundId;

    /// @dev Pool carried forward into the next round after finalisation.
    uint256 public carryOverPool;

    /// @dev Accumulated owner fees, claimable via withdrawOwnerFees().
    uint256 public pendingOwnerFees;

    mapping(uint256 => Round)    private rounds;
    mapping(uint256 => Ticket[]) private roundTickets;

    /// @dev Maps a Chainlink VRF requestId to the round that requested it.
    mapping(uint256 => uint256)  private vrfRequestToRound;

    /// @dev Pull-payment ledger: player address → claimable ETH.
    mapping(address => uint256)  public  pendingWithdrawals;

    //  EVENT

    event RoundStarted(
        uint256 indexed roundId,
        uint256 endTime,
        uint256 openingPool
    );
    event TicketPurchased(
        uint256 indexed roundId,
        address indexed player,
        uint8[7] numbers,
        uint256 ticketIndex
    );
    event DrawRequested(uint256 indexed roundId, uint256 vrfRequestId);
    event DrawCompleted(uint256 indexed roundId, uint8[7] winningNumbers);
    event CountingProgressed(uint256 indexed roundId, uint256 countedUpTo);
    event CountingDone(uint256 indexed roundId, uint256[8] tierCounts);
    event PrizeAwarded(
        uint256 indexed roundId,
        address indexed player,
        uint256 amount,
        uint8   matchCount
    );
    event RoundFinalized(uint256 indexed roundId, uint256 carryOut);
    event PrizeWithdrawn(address indexed player, uint256 amount);
    event OwnerFeesWithdrawn(address indexed owner, uint256 amount);


    //  CONSTRUCTOR

    /**
     * @param vrfCoordinator Address of the Chainlink VRF Coordinator v2.
     * @param subscriptionId Your funded Chainlink VRF subscription ID.
     * @param gasLane        Key hash for the gas lane you want to use.
     */
    constructor(
        address vrfCoordinator,
        uint64  subscriptionId,
        bytes32 gasLane
    ) VRFConsumerBaseV2(vrfCoordinator) Ownable() {
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinator);
        i_subscriptionId = subscriptionId;
        i_gasLane        = gasLane;
        _startRound();
    }

    //  BUY TICKET

    /**
     * @notice Buy a ticket for the current round.
     * @param numbers 7 strictly-ascending unique numbers, each in [1, 49].
     *
     * Requirements:
     * - msg.value must equal TICKET_PRICE exactly.
     * - The current round must still be open (not ended, draw not requested).
     * - Numbers must be strictly ascending and within [1, 49].
     */
    function buyTicket(uint8[7] calldata numbers) external payable nonReentrant {
        require(msg.value == TICKET_PRICE, "Wrong ticket price");

        Round storage r = rounds[currentRoundId];
        require(block.timestamp < r.endTime, "Round closed");
        require(!r.drawRequested,            "Draw pending; buy next round");

        _validateNumbers(numbers);

        uint256 ownerCut  = (TICKET_PRICE * OWNER_FEE_BPS) / BPS_DENOM;
        uint256 prizeShare = TICKET_PRICE - ownerCut;

        pendingOwnerFees += ownerCut;
        r.prizePool      += prizeShare;

        uint256 idx = roundTickets[currentRoundId].length;
        roundTickets[currentRoundId].push(
            Ticket({ player: msg.sender, numbers: numbers })
        );

        emit TicketPurchased(currentRoundId, msg.sender, numbers, idx);
    }

    //  TRIGGER DRAW  (permissionless – anyone may call)

    /**
     * @notice Trigger the VRF draw for the current round once its time elapses.
     *         Calling this also immediately opens the next round, so ticket
     *         purchases never stall while waiting for randomness.
     *
     *         If the round had zero tickets (e.g., middle of the night) the
     *         function skips the Chainlink call and carries the pool forward,
     *         saving LINK fees.
     */
    function triggerDraw() external {
        Round storage r = rounds[currentRoundId];
        require(block.timestamp >= r.endTime, "Round still active");
        require(!r.drawRequested,             "Already requested");

        r.drawRequested = true;
        uint256 roundId = currentRoundId;

        if (roundTickets[roundId].length == 0) {
            // ── Empty round: no VRF needed, carry over the pool ──
            r.drawCompleted   = true;
            r.countDone       = true;
            r.distributeDone  = true;
            r.carryOut        = r.prizePool;
            carryOverPool    += r.prizePool;
            emit DrawCompleted(roundId, r.winningNumbers); // emits zeros
            emit RoundFinalized(roundId, r.prizePool);
        } else {
            // ── Request Chainlink VRF ──
            uint256 reqId = i_vrfCoordinator.requestRandomWords(
                i_gasLane,
                i_subscriptionId,
                REQUEST_CONFIRMATIONS,
                CALLBACK_GAS_LIMIT,
                NUM_WORDS
            );
            vrfRequestToRound[reqId] = roundId;
            emit DrawRequested(roundId, reqId);
        }

        // Open the next round regardless of ticket count.
        _startRound();
    }

    //  CHAINLINK VRF CALLBACK

    /**
     * @dev Called by the VRF Coordinator with the requested random words.
     *      We keep this function minimal to stay safely within CALLBACK_GAS_LIMIT:
     *      just pick + sort the 7 winning balls and emit the result.
     *      Prize counting and distribution are handled by external calls.
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal override {
        uint256 roundId = vrfRequestToRound[requestId];
        Round storage r = rounds[roundId];
        require(!r.drawCompleted, "Already fulfilled");

        r.winningNumbers = _pickSortedNumbers(randomWords);
        r.drawCompleted  = true;

        emit DrawCompleted(roundId, r.winningNumbers);
    }

    //  PHASE 1 – COUNT WINNERS  (batchable, permissionless)

    /**
     * @notice Count winners per prize tier for a completed draw.
     *         Call repeatedly with a batchSize of ~200 until countDone == true.
     *
     * @param roundId   The round to process.
     * @param batchSize Tickets to scan in this call. 200 is a safe default.
     */
    function countRoundWinners(uint256 roundId, uint256 batchSize) external {
        Round storage r = rounds[roundId];
        require(r.drawCompleted, "Draw not completed");
        require(!r.countDone,    "Already counted");

        _countBatch(roundId, batchSize);
    }

    //  PHASE 2 – DISTRIBUTE PRIZES  (batchable, permissionless)

    /**
     * @notice Distribute prizes for a round whose counting phase is complete.
     *         Prizes accumulate in pendingWithdrawals; winners call withdrawPrize().
     *         Call repeatedly with a batchSize of ~200 until distributeDone == true.
     *
     * @param roundId   The round to distribute.
     * @param batchSize Tickets to process per call. 200 is a safe default.
     */
    function distributeRound(uint256 roundId, uint256 batchSize) external {
        Round storage r = rounds[roundId];
        require(r.countDone,       "Count not done yet");
        require(!r.distributeDone, "Already distributed");

        _distributeBatch(roundId, batchSize);
    }

    //  WITHDRAW PRIZE  (pull pattern)

    /**
     * @notice Withdraw all accumulated prize winnings for the caller.
     */
    function withdrawPrize() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{ value: amount }("");
        require(ok, "Transfer failed");

        emit PrizeWithdrawn(msg.sender, amount);
    }

    //  OWNER: WITHDRAW FEES

    /**
     * @notice Withdraw accumulated owner fees (10% of all ticket sales).
     */
    function withdrawOwnerFees() external onlyOwner nonReentrant {
        uint256 amount = pendingOwnerFees;
        require(amount > 0, "No fees to withdraw");
        pendingOwnerFees = 0;

        (bool ok, ) = owner().call{ value: amount }("");
        require(ok, "Transfer failed");

        emit OwnerFeesWithdrawn(owner(), amount);
    }

    //  VIEW / GETTER FUNCTIONS

    /**
     * @notice Returns key info about the currently active round.
     */
    function getCurrentRound() external view returns (
        uint256 roundId,
        uint256 startTime,
        uint256 endTime,
        uint256 prizePool,
        uint256 totalTickets,
        bool    drawRequested,
        bool    drawCompleted
    ) {
        Round storage r = rounds[currentRoundId];
        return (
            currentRoundId,
            r.startTime,
            r.endTime,
            r.prizePool,
            roundTickets[currentRoundId].length,
            r.drawRequested,
            r.drawCompleted
        );
    }

    /**
     * @notice Returns the sorted winning numbers for a completed round.
     */
    function getWinningNumbers(uint256 roundId)
        external view returns (uint8[7] memory)
    {
        return rounds[roundId].winningNumbers;
    }

    /**
     * @notice Returns a ticket by round and index.
     */
    function getTicket(uint256 roundId, uint256 idx)
        external view returns (address player, uint8[7] memory numbers)
    {
        Ticket storage t = roundTickets[roundId][idx];
        return (t.player, t.numbers);
    }

    /**
     * @notice Total tickets sold in a given round.
     */
    function getTicketCount(uint256 roundId) external view returns (uint256) {
        return roundTickets[roundId].length;
    }

    /**
     * @notice Seconds remaining in the current round (0 if ended).
     */
    function secondsUntilDraw() external view returns (uint256) {
        uint256 end = rounds[currentRoundId].endTime;
        return block.timestamp >= end ? 0 : end - block.timestamp;
    }

    /**
     * @notice True when the current round has ended and nobody has triggered the draw yet.
     */
    function canTriggerDraw() external view returns (bool) {
        Round storage r = rounds[currentRoundId];
        return block.timestamp >= r.endTime && !r.drawRequested;
    }

    /**
     * @notice Full processing status for any round (useful for front-ends / keepers).
     */
    function getRoundStatus(uint256 roundId) external view returns (
        bool    drawCompleted,
        bool    countDone,
        bool    distributeDone,
        uint256 totalTickets,
        uint256 countIdx,
        uint256 distributeIdx,
        uint256[8] memory tierCounts,
        uint256[8] memory tierPrizePerWinner,
        uint256 carryOut,
        uint256 prizePool
    ) {
        Round storage r = rounds[roundId];
        return (
            r.drawCompleted,
            r.countDone,
            r.distributeDone,
            roundTickets[roundId].length,
            r.countIdx,
            r.distributeIdx,
            r.tierCounts,
            r.tierPrizePerWinner,
            r.carryOut,
            r.prizePool
        );
    }

    //  INTERNAL: START NEW ROUND

    function _startRound() internal {
        currentRoundId++;
        Round storage r  = rounds[currentRoundId];
        r.startTime      = block.timestamp;
        r.endTime        = block.timestamp + ROUND_DURATION;
        r.prizePool      = carryOverPool;
        r.carriedIn      = carryOverPool;
        carryOverPool    = 0;

        emit RoundStarted(currentRoundId, r.endTime, r.prizePool);
    }

    //  INTERNAL: COUNT BATCH (Phase 1)

    function _countBatch(uint256 roundId, uint256 batchSize) internal {
        Round storage r     = rounds[roundId];
        Ticket[] storage ts = roundTickets[roundId];
        uint256 total        = ts.length;

        uint256 start = r.countIdx;
        uint256 end   = start + batchSize;
        if (end > total) end = total;

        uint8[7] memory winning = r.winningNumbers;

        for (uint256 i = start; i < end; ) {
            uint8 m = _countMatches(ts[i].numbers, winning);
            r.tierCounts[m]++;
            unchecked { ++i; }
        }

        r.countIdx = end;
        emit CountingProgressed(roundId, end);

        if (end == total) {
            _computeTierPrizes(roundId);
        }
    }

    //  INTERNAL: COMPUTE TIER PRIZES  (called once counting is done)

    function _computeTierPrizes(uint256 roundId) internal {
        Round storage r  = rounds[roundId];
        uint256 pool     = r.prizePool;

        // Start with the full pool; subtract only what is actually awarded.
        // What's left (no-winner tiers + rounding dust) becomes carryOut.
        uint256 awarded = 0;

        for (uint8 tier = 2; tier <= 7; ) {
            uint256 winners = r.tierCounts[tier];
            if (winners > 0) {
                uint256 tierTotal  = (pool * PRIZE_BPS[tier]) / BPS_DENOM;
                uint256 perWinner  = tierTotal / winners;
                r.tierPrizePerWinner[tier] = perWinner;
                awarded += perWinner * winners;
                // Rounding dust (tierTotal % winners) stays in carryOut.
            }
            // If winners == 0: tier allocation stays in carryOut (not subtracted).
            unchecked { ++tier; }
        }

        r.carryOut  = pool - awarded;
        r.countDone = true;

        emit CountingDone(roundId, r.tierCounts);
    }

    //  INTERNAL: DISTRIBUTE BATCH (Phase 2)

    function _distributeBatch(uint256 roundId, uint256 batchSize) internal {
        Round storage r     = rounds[roundId];
        Ticket[] storage ts = roundTickets[roundId];
        uint256 total        = ts.length;

        uint256 start = r.distributeIdx;
        uint256 end   = start + batchSize;
        if (end > total) end = total;

        uint8[7] memory winning = r.winningNumbers;

        for (uint256 i = start; i < end; ) {
            uint8 m = _countMatches(ts[i].numbers, winning);
            if (m >= 2) {
                uint256 prize = r.tierPrizePerWinner[m];
                if (prize > 0) {
                    pendingWithdrawals[ts[i].player] += prize;
                    emit PrizeAwarded(roundId, ts[i].player, prize, m);
                }
            }
            unchecked { ++i; }
        }

        r.distributeIdx = end;

        if (end == total) {
            r.distributeDone = true;
            carryOverPool   += r.carryOut;
            emit RoundFinalized(roundId, r.carryOut);
        }
    }

    //  INTERNAL: VALIDATE TICKET NUMBERS

    function _validateNumbers(uint8[7] calldata n) internal pure {
        require(n[0] >= 1 && n[0] <= MAX_BALL, "Number out of range [1,49]");
        for (uint8 i = 1; i < BALLS; ) {
            require(n[i] > n[i - 1],    "Numbers must be strictly ascending");
            require(n[i] <= MAX_BALL,   "Number out of range [1,49]");
            unchecked { ++i; }
        }
    }

    //  INTERNAL: FISHER-YATES – PICK 7 UNIQUE SORTED NUMBERS

    /**
     * @dev Uses partial Fisher-Yates shuffle over [1..49] to select 7 unique
     *      numbers, then sorts them ascending (insertion sort on 7 elements).
     *      Each of the 7 random words drives one independent selection step,
     *      making the combined output unbiased and unpredictable.
     */
    function _pickSortedNumbers(uint256[] memory rng)
        internal pure returns (uint8[7] memory)
    {
        // Build candidate pool [1..49]
        uint8[49] memory pool;
        for (uint8 i = 0; i < 49; ) {
            pool[i] = i + 1;
            unchecked { ++i; }
        }

        // Partial Fisher-Yates: pick 7 unique values
        uint8[7] memory picked;
        for (uint8 i = 0; i < 7; ) {
            uint256 remaining = 49 - i;
            uint256 j         = i + (rng[i] % remaining);   // j in [i, 48]
            // Swap pool[i] ↔ pool[j]
            uint8 tmp = pool[i];
            pool[i]   = pool[j];
            pool[j]   = tmp;
            picked[i] = pool[i];
            unchecked { ++i; }
        }

        // Insertion sort (ascending) – 7 elements, O(49) worst case
        for (uint8 i = 1; i < 7; ) {
            uint8 key = picked[i];
            int8  j   = int8(i) - 1;
            while (j >= 0 && picked[uint8(j)] > key) {
                picked[uint8(j + 1)] = picked[uint8(j)];
                unchecked { --j; }
            }
            picked[uint8(j + 1)] = key;
            unchecked { ++i; }
        }

        return picked;
    }

    //  INTERNAL: COUNT MATCHES  (two-pointer, both arrays sorted)

    /**
     * @dev Both arrays are guaranteed to be sorted ascending, so a single
     *      O(n+m) two-pointer pass is correct and cheap.
     */
    function _countMatches(
        uint8[7] memory a,
        uint8[7] memory b
    ) internal pure returns (uint8 matches) {
        uint8 ai = 0;
        uint8 bi = 0;
        while (ai < 7 && bi < 7) {
            if      (a[ai] == b[bi]) { ++matches; ++ai; ++bi; }
            else if (a[ai]  < b[bi]) { ++ai; }
            else                     { ++bi; }
        }
    }
}
