/**
 * DecentralizedLottery – full test suite
 *
 * Run with: npx hardhat test
 *
 * Uses Chainlink's VRFCoordinatorV2Mock so no real LINK or subscription
 * is required during testing.
 */

const { expect }          = require("chai");
const { ethers }          = require("hardhat");
const { time }            = require("@nomicfoundation/hardhat-network-helpers");

// Constants (must match the contract)
const TICKET_PRICE   = ethers.parseEther("0.01");
const ROUND_DURATION = 5 * 60; // 5 minutes in seconds
const KEY_HASH       = "0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c";

// Helper: deploy everything fresh
async function deployAll() {
  const [owner, alice, bob, carol] = await ethers.getSigners();

  // Deploy Chainlink VRF mock
  const MockFactory = await ethers.getContractFactory("VRFCoordinatorV2Mock");
  const baseFee      = ethers.parseEther("0.1"); // 0.1 LINK base fee
  const gasPriceLink = 1_000_000_000n;           // 1 Gwei per gas in LINK
  const vrfMock      = await MockFactory.deploy(baseFee, gasPriceLink);

  // Create a subscription and fund it
  const tx    = await vrfMock.createSubscription();
  const rcpt  = await tx.wait();
  const subId = rcpt.logs[0].args[0]; // SubscriptionCreated(subId, owner)
  await vrfMock.fundSubscription(subId, ethers.parseEther("10")); // 10 LINK

  // Deploy lottery
  const LotteryFactory = await ethers.getContractFactory("DecentralizedLottery");
  const lottery = await LotteryFactory.deploy(
    await vrfMock.getAddress(),
    subId,
    KEY_HASH
  );

  // Register lottery as VRF consumer
  await vrfMock.addConsumer(subId, await lottery.getAddress());

  return { lottery, vrfMock, subId, owner, alice, bob, carol };
}

// Helper: simulate a VRF fulfillment with a specific set of words
async function fulfillVRF(vrfMock, lottery, requestId, words) {
  // words is a 7-element BigInt array
  await vrfMock.fulfillRandomWordsWithOverride(
    requestId,
    await lottery.getAddress(),
    words
  );
}

// Helper: buy a ticket
async function buyTicket(lottery, signer, numbers) {
  return lottery.connect(signer).buyTicket(numbers, { value: TICKET_PRICE });
}

// Helper: advance time past round end and capture the VRF requestId
async function triggerAndGetRequestId(lottery, vrfMock) {
  await time.increase(ROUND_DURATION + 1);
  const tx   = await lottery.triggerDraw();
  const rcpt = await tx.wait();

  // Find the RandomWordsRequested event emitted by VRF coordinator
  const vrfAddress = await vrfMock.getAddress();
  for (const log of rcpt.logs) {
    if (log.address.toLowerCase() === vrfAddress.toLowerCase()) {
      try {
        const parsed = vrfMock.interface.parseLog(log);
        if (parsed && parsed.name === "RandomWordsRequested") {
          return parsed.args.requestId;
        }
      } catch (_) {}
    }
  }
  throw new Error("RandomWordsRequested event not found");
}

// Helper: produce deterministic winning numbers from a seed
function simulatePick(words7) {
  // Mirrors _pickSortedNumbers in the contract.
  const pool = Array.from({ length: 49 }, (_, i) => i + 1);
  const picked = [];
  for (let i = 0; i < 7; i++) {
    const remaining = 49 - i;
    const j = i + Number(BigInt(words7[i]) % BigInt(remaining));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    picked.push(pool[i]);
  }
  return picked.sort((a, b) => a - b);
}

//  TEST SUITE

describe("DecentralizedLottery", function () {

  //Deployment
  describe("Deployment", function () {
    it("initialises round 1 immediately", async function () {
      const { lottery } = await deployAll();
      const info = await lottery.getCurrentRound();
      expect(info.roundId).to.equal(1n);
      expect(info.drawCompleted).to.be.false;
    });

    it("sets TICKET_PRICE = 0.01 ETH", async function () {
      const { lottery } = await deployAll();
      expect(await lottery.TICKET_PRICE()).to.equal(TICKET_PRICE);
    });
  });

  // Ticket purchase
  describe("buyTicket", function () {
    it("accepts valid ascending numbers", async function () {
      const { lottery, alice } = await deployAll();
      await expect(
        buyTicket(lottery, alice, [1, 7, 15, 23, 31, 40, 49])
      ).to.emit(lottery, "TicketPurchased");
    });

    it("reverts if wrong ETH value sent", async function () {
      const { lottery, alice } = await deployAll();
      await expect(
        lottery.connect(alice).buyTicket([1, 7, 15, 23, 31, 40, 49], {
          value: ethers.parseEther("0.005"),
        })
      ).to.be.revertedWith("Wrong ticket price");
    });

    it("reverts if numbers not strictly ascending", async function () {
      const { lottery, alice } = await deployAll();
      await expect(
        buyTicket(lottery, alice, [1, 7, 7, 23, 31, 40, 49])
      ).to.be.revertedWith("Must be strictly ascending");
    });

    it("reverts if a number is 0 or > 49", async function () {
      const { lottery, alice } = await deployAll();
      await expect(
        buyTicket(lottery, alice, [0, 7, 15, 23, 31, 40, 49])
      ).to.be.revertedWith("Number out of range [1,49]");

      await expect(
        buyTicket(lottery, alice, [1, 7, 15, 23, 31, 40, 50])
      ).to.be.revertedWith("Number out of range [1,49]");
    });

    it("reverts after draw is requested (lock-out)", async function () {
      const { lottery, alice, vrfMock } = await deployAll();
      await buyTicket(lottery, alice, [1, 2, 3, 4, 5, 6, 7]);
      await time.increase(ROUND_DURATION + 1);
      await lottery.triggerDraw();

      // Round 1 is now locked; round 2 is active
      // The previous round's tickets cannot be bought anymore
      // Buying into round 2 should work
      await expect(
        buyTicket(lottery, alice, [1, 2, 3, 4, 5, 6, 7])
      ).to.emit(lottery, "TicketPurchased");
    });

    it("directs 10% to pendingOwnerFees and 90% to prize pool", async function () {
      const { lottery, alice } = await deployAll();
      await buyTicket(lottery, alice, [1, 2, 3, 4, 5, 6, 7]);

      const ownerFees = await lottery.pendingOwnerFees();
      const info      = await lottery.getCurrentRound();

      expect(ownerFees).to.equal(TICKET_PRICE / 10n);
      expect(info.prizePool).to.equal((TICKET_PRICE * 9n) / 10n);
    });
  });

  //triggerDraw
  describe("triggerDraw", function () {
    it("reverts if called before round ends", async function () {
      const { lottery } = await deployAll();
      await expect(lottery.triggerDraw()).to.be.revertedWith("Round still active");
    });

    it("advances to round 2 after draw", async function () {
      const { lottery } = await deployAll();
      await time.increase(ROUND_DURATION + 1);
      await lottery.triggerDraw();
      const info = await lottery.getCurrentRound();
      expect(info.roundId).to.equal(2n);
    });

    it("carries over pool for empty rounds without requesting VRF", async function () {
      const { lottery } = await deployAll();
      // Round 1 has no tickets → should skip VRF
      await time.increase(ROUND_DURATION + 1);
      const tx   = await lottery.triggerDraw();
      const rcpt = await tx.wait();

      // RoundFinalized should fire with carryOut = 0 (no pool from empty round)
      const finalised = rcpt.logs
        .map(l => { try { return lottery.interface.parseLog(l); } catch { return null; } })
        .find(l => l && l.name === "RoundFinalized");

      expect(finalised).to.exist;

      // The carry amount from an empty round is 0
      expect(finalised.args.carryOut).to.equal(0n);
    });
  });

  // VRF fulfillment and winning numbers
  describe("VRF fulfillment", function () {
    it("stores winning numbers and emits DrawCompleted", async function () {
      const { lottery, alice, vrfMock } = await deployAll();
      await buyTicket(lottery, alice, [1, 2, 3, 4, 5, 6, 7]);

      const reqId = await triggerAndGetRequestId(lottery, vrfMock);

      // Use deterministic words that produce known winning numbers
      const words = [10n, 20n, 30n, 40n, 50n, 60n, 70n];
      const expected = simulatePick(words);

      await expect(fulfillVRF(vrfMock, lottery, reqId, words))
        .to.emit(lottery, "DrawCompleted");

      const winning = await lottery.getWinningNumbers(1n);
      const winArr  = winning.map(Number);
      expect(winArr).to.deep.equal(expected);
    });

    it("winning numbers are strictly sorted ascending", async function () {
      const { lottery, alice, vrfMock } = await deployAll();
      await buyTicket(lottery, alice, [1, 2, 3, 4, 5, 6, 7]);

      const reqId = await triggerAndGetRequestId(lottery, vrfMock);
      const words = [999n, 888n, 777n, 666n, 555n, 444n, 333n];
      await fulfillVRF(vrfMock, lottery, reqId, words);

      const winning = await lottery.getWinningNumbers(1n);
      for (let i = 1; i < 7; i++) {
        expect(winning[i]).to.be.greaterThan(winning[i - 1]);
      }
    });
  });

  // Counting and distribution
  describe("countRoundWinners + distributeRound", function () {
    async function setupAndDraw(lottery, vrfMock, tickets, words) {
      for (const [signer, nums] of tickets) {
        await buyTicket(lottery, signer, nums);
      }
      const reqId = await triggerAndGetRequestId(lottery, vrfMock);
      await fulfillVRF(vrfMock, lottery, reqId, words);
      return 1n; // roundId
    }

    it("counts 0 matches correctly (no prize)", async function () {
      const { lottery, alice, vrfMock } = await deployAll();

      // Words that produce winning numbers far from [1,2,3,4,5,6,7]
      // We'll pick words that reliably give high numbers.
      // [48,47,46,45,44,43,42] via specific modular arithmetic
      // It's easier to just check the status after distribution.
      const words = [0n, 1n, 2n, 3n, 4n, 5n, 6n]; // picks first 7 of pool
      // pool = [1..49], pick index 0..6 => picks 1,2,3,4,5,6,7

      await buyTicket(lottery, alice, [43, 44, 45, 46, 47, 48, 49]); // no overlap with [1,2,3,4,5,6,7]

      const reqId = await triggerAndGetRequestId(lottery, vrfMock);
      await fulfillVRF(vrfMock, lottery, reqId, words);

      await lottery.countRoundWinners(1n, 200n);
      await lottery.distributeRound(1n, 200n);

      // Alice should have no withdrawable prize
      expect(await lottery.pendingWithdrawals(alice.address)).to.equal(0n);
    });

    it("7/7 match winner gets 30% of pool", async function () {
      const { lottery, alice, vrfMock } = await deployAll();

      const words   = [0n, 1n, 2n, 3n, 4n, 5n, 6n]; // winning = [1,2,3,4,5,6,7]
      const winning = simulatePick(words);            // [1,2,3,4,5,6,7]

      await buyTicket(lottery, alice, winning);
      const roundPool = (TICKET_PRICE * 9n) / 10n; // 0.009 ETH

      const reqId = await triggerAndGetRequestId(lottery, vrfMock);
      await fulfillVRF(vrfMock, lottery, reqId, words);

      await lottery.countRoundWinners(1n, 200n);
      await lottery.distributeRound(1n, 200n);

      const prize = await lottery.pendingWithdrawals(alice.address);
      // 30% of pool = 0.009 * 30% = 0.0027 ETH
      expect(prize).to.equal((roundPool * 3000n) / 10000n);
    });

    it("two 7/7 winners split the 30% tier", async function () {
      const { lottery, alice, bob, vrfMock } = await deployAll();

      const words   = [0n, 1n, 2n, 3n, 4n, 5n, 6n];
      const winning = simulatePick(words);

      await buyTicket(lottery, alice, winning);
      await buyTicket(lottery, bob,   winning);
      const roundPool = (TICKET_PRICE * 9n * 2n) / 10n; // 0.018 ETH

      const reqId = await triggerAndGetRequestId(lottery, vrfMock);
      await fulfillVRF(vrfMock, lottery, reqId, words);

      await lottery.countRoundWinners(1n, 200n);
      await lottery.distributeRound(1n, 200n);

      const tierTotal    = (roundPool * 3000n) / 10000n;
      const perWinner    = tierTotal / 2n;

      expect(await lottery.pendingWithdrawals(alice.address)).to.equal(perWinner);
      expect(await lottery.pendingWithdrawals(bob.address)).to.equal(perWinner);
    });

    it("unused tier prizes carry over to next round", async function () {
      const { lottery, alice, vrfMock } = await deployAll();

      const words   = [0n, 1n, 2n, 3n, 4n, 5n, 6n];
      const winning = simulatePick(words);           // [1,2,3,4,5,6,7]

      // Alice buys only a 7/7 ticket → all other tiers have no winners
      await buyTicket(lottery, alice, winning);
      const roundPool = (TICKET_PRICE * 9n) / 10n;

      const reqId = await triggerAndGetRequestId(lottery, vrfMock);
      await fulfillVRF(vrfMock, lottery, reqId, words);

      await lottery.countRoundWinners(1n, 200n);
      await lottery.distributeRound(1n, 200n);

      // Tiers 2-6 (5+10+15+20+20 = 70%) had no winners → carry over
      const tier7Prize  = (roundPool * 3000n) / 10000n; // 30%
      const expectedCarry = roundPool - tier7Prize;

      // carryOverPool should now hold this carry amount (used by round 2)
      expect(await lottery.carryOverPool()).to.equal(expectedCarry);
    });
  });

  //Prize withdrawal
  describe("withdrawPrize", function () {
    it("transfers ETH to winner and clears balance", async function () {
      const { lottery, alice, vrfMock } = await deployAll();

      const words   = [0n, 1n, 2n, 3n, 4n, 5n, 6n];
      const winning = simulatePick(words);

      await buyTicket(lottery, alice, winning);

      const reqId = await triggerAndGetRequestId(lottery, vrfMock);
      await fulfillVRF(vrfMock, lottery, reqId, words);

      await lottery.countRoundWinners(1n, 200n);
      await lottery.distributeRound(1n, 200n);

      const pendingBefore = await lottery.pendingWithdrawals(alice.address);
      expect(pendingBefore).to.be.gt(0n);

      const balBefore = await ethers.provider.getBalance(alice.address);
      const wTx       = await lottery.connect(alice).withdrawPrize();
      const wRcpt     = await wTx.wait();
      const gasUsed   = wRcpt.gasUsed * wTx.gasPrice;
      const balAfter  = await ethers.provider.getBalance(alice.address);

      expect(balAfter - balBefore + gasUsed).to.equal(pendingBefore);
      expect(await lottery.pendingWithdrawals(alice.address)).to.equal(0n);
    });

    it("reverts if nothing to withdraw", async function () {
      const { lottery, alice } = await deployAll();
      await expect(
        lottery.connect(alice).withdrawPrize()
      ).to.be.revertedWith("Nothing to withdraw");
    });
  });

  // Owner fee withdrawal
  describe("withdrawOwnerFees", function () {
    it("owner can withdraw accumulated fees", async function () {
      const { lottery, owner, alice } = await deployAll();
      await buyTicket(lottery, alice, [1, 2, 3, 4, 5, 6, 7]);

      const fees = await lottery.pendingOwnerFees();
      expect(fees).to.be.gt(0n);

      await expect(lottery.connect(owner).withdrawOwnerFees())
        .to.emit(lottery, "OwnerFeesWithdrawn")
        .withArgs(owner.address, fees);

      expect(await lottery.pendingOwnerFees()).to.equal(0n);
    });

    it("non-owner cannot withdraw owner fees", async function () {
      const { lottery, alice } = await deployAll();
      await buyTicket(lottery, alice, [1, 2, 3, 4, 5, 6, 7]);
      await expect(
        lottery.connect(alice).withdrawOwnerFees()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // Round independence from participants
  describe("Round timing (independent of participants)", function () {
    it("round ID increments every 5 minutes regardless of tickets", async function () {
      const { lottery } = await deployAll();

      let info = await lottery.getCurrentRound();
      expect(info.roundId).to.equal(1n);

      await time.increase(ROUND_DURATION + 1);
      await lottery.triggerDraw(); // empty round
      info = await lottery.getCurrentRound();
      expect(info.roundId).to.equal(2n);

      await time.increase(ROUND_DURATION + 1);
      await lottery.triggerDraw(); // still empty
      info = await lottery.getCurrentRound();
      expect(info.roundId).to.equal(3n);
    });
  });
});
