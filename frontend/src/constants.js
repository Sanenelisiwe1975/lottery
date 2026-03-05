// Contract Addresses
// After deploying with Hardhat, paste the printed address here for each network.
export const CONTRACT_ADDRESSES = {
  11155111: "0x4fbD09661e5480A806daA8826497d1339f5d6F01",    // Ethereum Sepolia testnet
  137:      "0xYOUR_POLYGON_ADDRESS",    // Polygon Mainnet
  80001:    "0xYOUR_MUMBAI_ADDRESS",     // Polygon Mumbai testnet
  31337:    "0x5FbDB2315678afecb367f032d93F642f64180aa3", // Hardhat localhost
};

export const NETWORK_NAMES = {
  11155111: "Sepolia",
  137:      "Polygon",
  80001:    "Mumbai",
  31337:    "Localhost",
};

//ABI (human-readable, compatible with ethers.js v6)
export const ABI = [
  "function TICKET_PRICE() view returns (uint256)",
  "function ROUND_DURATION() view returns (uint256)",
  "function currentRoundId() view returns (uint256)",
  "function carryOverPool() view returns (uint256)",
  "function pendingOwnerFees() view returns (uint256)",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function owner() view returns (address)",

  "function getCurrentRound() view returns (uint256 roundId, uint256 startTime, uint256 endTime, uint256 prizePool, uint256 totalTickets, bool drawRequested, bool drawCompleted)",
  "function getWinningNumbers(uint256 roundId) view returns (uint8[7])",
  "function getTicket(uint256 roundId, uint256 idx) view returns (address player, uint8[7] numbers)",
  "function getTicketCount(uint256 roundId) view returns (uint256)",
  "function getRoundStatus(uint256 roundId) view returns (bool drawCompleted, bool countDone, bool distributeDone, uint256 totalTickets, uint256 countIdx, uint256 distributeIdx, uint256[8] tierCounts, uint256[8] tierPrizePerWinner, uint256 carryOut, uint256 prizePool)",

  "function secondsUntilDraw() view returns (uint256)",
  "function canTriggerDraw() view returns (bool)",

  "function buyTicket(uint8[7] calldata numbers) payable",
  "function triggerDraw()",
  "function countRoundWinners(uint256 roundId, uint256 batchSize)",
  "function distributeRound(uint256 roundId, uint256 batchSize)",
  "function withdrawPrize()",
  "function withdrawOwnerFees()",

  "event RoundStarted(uint256 indexed roundId, uint256 endTime, uint256 openingPool)",
  "event TicketPurchased(uint256 indexed roundId, address indexed player, uint8[7] numbers, uint256 ticketIndex)",
  "event DrawCompleted(uint256 indexed roundId, uint8[7] winningNumbers)",
  "event CountingDone(uint256 indexed roundId, uint256[8] tierCounts)",
  "event PrizeAwarded(uint256 indexed roundId, address indexed player, uint256 amount, uint8 matchCount)",
  "event RoundFinalized(uint256 indexed roundId, uint256 carryOut)",
  "event PrizeWithdrawn(address indexed player, uint256 amount)",
];

// Prize table
export const PRIZE_TABLE = [
  { matches: 2, pct: 5  },
  { matches: 3, pct: 10 },
  { matches: 4, pct: 15 },
  { matches: 5, pct: 20 },
  { matches: 6, pct: 20 },
  { matches: 7, pct: 30 },
];
