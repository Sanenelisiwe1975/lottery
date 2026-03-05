"use strict";
const express = require("express");
const db      = require("../db");
const router  = express.Router();

// Helper: parse JSON columns safely
function parseRound(r) {
  if (!r) return null;
  return {
    ...r,
    winning_nums: r.winning_nums ? JSON.parse(r.winning_nums) : null,
  };
}

// GET /api/rounds
// Paginated list of all rounds (newest first).
// Query: ?limit=20&offset=0
router.get("/", (req, res) => {
  const limit  = Math.min(Number(req.query.limit  || 20), 100);
  const offset = Number(req.query.offset || 0);
  const rows   = db.getRounds(limit, offset).map(parseRound);
  res.json({ rounds: rows, limit, offset });
});

// GET /api/rounds/history
// Last N finalized rounds with their winners – the "winner board".
// Query: ?limit=10
router.get("/history", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 10), 50);
  const rounds = db.getRecentFinalized(limit).map((r) => {
    const round   = parseRound(r);
    const winners = db.getWinnersByRound(r.round_id);
    return { ...round, winners };
  });
  res.json({ rounds });
});

// GET /api/rounds/:id
// Full detail for one round, including all winners and ticket count.
router.get("/:id", (req, res) => {
  const roundId = Number(req.params.id);
  if (!Number.isInteger(roundId) || roundId < 1) {
    return res.status(400).json({ error: "Invalid round ID" });
  }

  const round = db.getRound(roundId);
  if (!round) return res.status(404).json({ error: "Round not found" });

  const winners = db.getWinnersByRound(roundId);
  const tickets = db.getTicketsByRound(roundId).map((t) => ({
    ...t,
    numbers: JSON.parse(t.numbers),
  }));

  res.json({
    round:   parseRound(round),
    winners,
    tickets,
  });
});

// GET /api/rounds/:id/winners
router.get("/:id/winners", (req, res) => {
  const roundId = Number(req.params.id);
  res.json({ winners: db.getWinnersByRound(roundId) });
});

module.exports = router;
