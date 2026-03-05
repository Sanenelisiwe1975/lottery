"use strict";
const express = require("express");
const db      = require("../db");
const router  = express.Router();

// GET /api/players/:address/wins
// All winning tickets for a player (newest first).
// Query: ?limit=50&offset=0
router.get("/:address/wins", (req, res) => {
  const addr   = req.params.address;
  const limit  = Math.min(Number(req.query.limit  || 50), 200);
  const offset = Number(req.query.offset || 0);

  const wins  = db.getWinsByPlayer(addr, limit, offset);
  const total = db.totalWonByPlayer(addr);

  res.json({
    address:  addr,
    totalWonEth: String(total),
    wins,
    limit,
    offset,
  });
});

// GET /api/players/:address/tickets
// All tickets bought by a player, enriched with round status + winning nums.
// Query: ?limit=50&offset=0
router.get("/:address/tickets", (req, res) => {
  const addr   = req.params.address;
  const limit  = Math.min(Number(req.query.limit  || 50), 200);
  const offset = Number(req.query.offset || 0);

  const tickets = db.getTicketsByPlayer(addr, limit, offset).map((t) => ({
    ...t,
    numbers:      JSON.parse(t.numbers),
    winning_nums: t.winning_nums ? JSON.parse(t.winning_nums) : null,
  }));

  res.json({ address: addr, tickets, limit, offset });
});

module.exports = router;
