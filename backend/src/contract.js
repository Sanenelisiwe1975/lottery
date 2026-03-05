"use strict";
require("dotenv").config();
const { ethers } = require("ethers");

const ABI = [
  "function TICKET_PRICE() view returns (uint256)",
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

  "function triggerDraw()",
  "function countRoundWinners(uint256 roundId, uint256 batchSize)",
  "function distributeRound(uint256 roundId, uint256 batchSize)",

  "event RoundStarted(uint256 indexed roundId, uint256 endTime, uint256 openingPool)",
  "event TicketPurchased(uint256 indexed roundId, address indexed player, uint8[7] numbers, uint256 ticketIndex)",
  "event DrawRequested(uint256 indexed roundId, uint256 vrfRequestId)",
  "event DrawCompleted(uint256 indexed roundId, uint8[7] winningNumbers)",
  "event CountingDone(uint256 indexed roundId, uint256[8] tierCounts)",
  "event PrizeAwarded(uint256 indexed roundId, address indexed player, uint256 amount, uint8 matchCount)",
  "event RoundFinalized(uint256 indexed roundId, uint256 carryOut)",
];

let _provider = null;
let _signer   = null;
let _contract = null; // read-only (provider)
let _rw       = null; // read-write (signer)

/**
 * Connect to the blockchain.
 * Call once on startup; provider auto-reconnects on WebSocket drop.
 */
function connect() {
  const rpcUrl  = process.env.RPC_URL;
  const privKey = process.env.KEEPER_PRIVATE_KEY;
  const address = process.env.CONTRACT_ADDRESS;

  if (!rpcUrl || !privKey || !address) {
    throw new Error("RPC_URL, KEEPER_PRIVATE_KEY and CONTRACT_ADDRESS must be set in .env");
  }

  // WebSocket provider for reliable event subscriptions
  _provider = new ethers.WebSocketProvider(rpcUrl);
  _signer   = new ethers.Wallet(privKey, _provider);
  _contract = new ethers.Contract(address, ABI, _provider);
  _rw       = new ethers.Contract(address, ABI, _signer);

  // Auto-reconnect on WebSocket error / close
  _provider.websocket.on("error", (err) => {
    console.error("[provider] WebSocket error:", err.message);
  });
  _provider.websocket.on("close", () => {
    console.warn("[provider] WebSocket closed – reconnecting in 5 s…");
    setTimeout(connect, 5_000);
  });

  console.log("[provider] Connected to", rpcUrl.slice(0, 40) + "…");
  return { provider: _provider, signer: _signer, contract: _contract, rw: _rw };
}

const get = () => ({
  provider: _provider,
  signer:   _signer,
  contract: _contract,
  rw:       _rw,
});

module.exports = { connect, get };
