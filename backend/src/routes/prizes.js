"use strict";
const express    = require("express");
const { ethers } = require("ethers");

const db              = require("../db");
const { get }         = require("../contract");
const { loadWallet }  = require("../wallet");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/pending", requireAuth, async (req, res) => {
  try {
    const walletRow = db.getWallet(req.user.id);
    if (!walletRow) return res.json({ pendingEth: "0" });

    const { contract } = get();
    const raw = await contract.pendingWithdrawals(walletRow.address);
    res.json({ pendingEth: ethers.formatEther(raw) });
  } catch (err) {
    console.error("[prizes] pending error:", err);
    res.status(500).json({ error: "Failed to fetch pending prize" });
  }
});

router.get("/history", requireAuth, (req, res) => {
  try {
    const walletRow = db.getWallet(req.user.id);
    if (!walletRow) return res.json([]);

    const limit  = Math.min(parseInt(req.query.limit  || "50", 10), 200);
    const offset = parseInt(req.query.offset || "0", 10);
    const rows   = db.getWinsByPlayer(walletRow.address, limit, offset);
    res.json(rows);
  } catch (err) {
    console.error("[prizes] history error:", err);
    res.status(500).json({ error: "Failed to fetch prize history" });
  }
});

router.post("/claim", requireAuth, async (req, res) => {
  try {
    const walletRow = db.getWallet(req.user.id);
    if (!walletRow) {
      return res.status(500).json({ error: "Wallet not found for this account" });
    }

    const { contract, provider } = get();

    // Check there is something to claim
    const pending = await contract.pendingWithdrawals(walletRow.address);
    if (pending === 0n) {
      return res.status(400).json({ error: "No prizes to claim" });
    }

    const userWallet   = loadWallet(walletRow.encrypted_key, provider);
    const userContract = contract.connect(userWallet);

    const tx = await userContract.withdrawPrize();
    const receipt = await tx.wait(1);

    const ethAmount = ethers.formatEther(pending);
    console.log(
      `[prizes] User ${req.user.id} claimed ${ethAmount} ETH (tx: ${receipt.hash})`
    );

    const ticketPriceEth   = parseFloat(process.env.TICKET_PRICE_ETH || "0.01");
    const creditsEarned    = Math.floor(parseFloat(ethAmount) / ticketPriceEth);

    if (creditsEarned > 0) {
      db.addCredits(req.user.id, creditsEarned);
    }

    res.json({
      success:      true,
      txHash:       receipt.hash,
      ethClaimed:   ethAmount,
      creditsAdded: creditsEarned,
    });
  } catch (err) {
    console.error("[prizes] claim error:", err);
    res.status(500).json({ error: "Failed to claim prize" });
  }
});

module.exports = router;
