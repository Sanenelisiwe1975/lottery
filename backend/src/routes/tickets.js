"use strict";
const express  = require("express");
const { ethers } = require("ethers");

const db              = require("../db");
const { get }         = require("../contract");
const { loadWallet }  = require("../wallet");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const TICKET_PRICE_ETH = "0.01";

/**
 * Ensure the user's custodial wallet has enough ETH to cover gas.
 * If not, the keeper wallet tops it up with a small amount.
 */
async function ensureGas(userAddress, provider) {
  const MIN_GAS_ETH  = ethers.parseEther("0.003");
  const TOP_UP_ETH   = ethers.parseEther("0.005");
  const balance      = await provider.getBalance(userAddress);

  if (balance < MIN_GAS_ETH) {
    const { rw } = get(); 
    const tx = await rw.runner.sendTransaction({
      to:    userAddress,
      value: TOP_UP_ETH,
    });
    await tx.wait(1);
    console.log(`[relay] Topped up ${userAddress} with ${ethers.formatEther(TOP_UP_ETH)} ETH`);
  }
}

router.post("/buy", requireAuth, async (req, res) => {
  try {
    const { numbers } = req.body;

    if (!Array.isArray(numbers) || numbers.length !== 7) {
      return res.status(400).json({ error: "Provide exactly 7 numbers" });
    }
    if (!numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 49)) {
      return res.status(400).json({ error: "Each number must be an integer between 1 and 49" });
    }
    const sorted = [...numbers].sort((a, b) => a - b);
    if (new Set(sorted).size !== 7) {
      return res.status(400).json({ error: "Numbers must be unique" });
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] <= sorted[i - 1]) {
        return res.status(400).json({ error: "Numbers must be strictly ascending" });
      }
    }

    const credits = db.getBalance(req.user.id);
    if (credits < 1) {
      return res.status(402).json({ error: "Insufficient credits. Please add credits first." });
    }

    const walletRow = db.getWallet(req.user.id);
    if (!walletRow) {
      return res.status(500).json({ error: "Wallet not found for this account" });
    }

    const { provider } = get();
    const userWallet   = loadWallet(walletRow.encrypted_key, provider);

    await ensureGas(userWallet.address, provider);

    const { contract } = get();
    const userContract = contract.connect(userWallet);

    const deducted = db.deductCredit(req.user.id);
    if (deducted.changes === 0) {
      return res.status(402).json({ error: "Insufficient credits" });
    }

    let tx;
    try {
      tx = await userContract.buyTicket(sorted, {
        value: ethers.parseEther(TICKET_PRICE_ETH),
      });
      await tx.wait(1);
    } catch (txErr) {

      db.addCredits(req.user.id, 1);
      console.error("[relay] buyTicket tx failed:", txErr.message);
      return res.status(500).json({ error: "Transaction failed. Credit has been refunded." });
    }

    res.json({
      success: true,
      txHash:  tx.hash,
      numbers: sorted,
    });
  } catch (err) {
    console.error("[tickets] buy error:", err);
    res.status(500).json({ error: "Failed to purchase ticket" });
  }
});

router.get("/mine", requireAuth, (req, res) => {
  try {
    const walletRow = db.getWallet(req.user.id);
    if (!walletRow) return res.json([]);

    const limit  = Math.min(parseInt(req.query.limit  || "50", 10), 200);
    const offset = parseInt(req.query.offset || "0", 10);
    const rows   = db.getTicketsByPlayer(walletRow.address, limit, offset);
    res.json(rows);
  } catch (err) {
    console.error("[tickets] mine error:", err);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

module.exports = router;
