"use strict";
const Database = require("better-sqlite3");
const path     = require("path");

const DB_PATH = path.join(__dirname, "..", "lottery.db");
const db      = new Database(DB_PATH);

// Pragma for performance and safety
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS rounds (
    round_id       INTEGER PRIMARY KEY,
    start_time     INTEGER,
    end_time       INTEGER,
    prize_pool_eth TEXT    NOT NULL DEFAULT '0',
    carry_in_eth   TEXT    NOT NULL DEFAULT '0',
    total_tickets  INTEGER NOT NULL DEFAULT 0,
    winning_nums   TEXT,          -- JSON array e.g. [3,7,15,22,31,40,48]
    carry_out_eth  TEXT    NOT NULL DEFAULT '0',
    status         TEXT    NOT NULL DEFAULT 'open',
    -- status: open | drawing | vrf_pending | counting | distributing | finalized
    trigger_tx     TEXT,          -- tx hash of triggerDraw()
    finalize_tx    TEXT,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id       INTEGER NOT NULL REFERENCES rounds(round_id),
    player         TEXT    NOT NULL,
    numbers        TEXT    NOT NULL,   -- JSON array
    ticket_index   INTEGER NOT NULL,
    tx_hash        TEXT,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_round  ON tickets(round_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_player ON tickets(player);

  CREATE TABLE IF NOT EXISTS winners (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id       INTEGER NOT NULL REFERENCES rounds(round_id),
    player         TEXT    NOT NULL,
    ticket_index   INTEGER,
    match_count    INTEGER NOT NULL,
    prize_eth      TEXT    NOT NULL,
    tx_hash        TEXT,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_winners_round  ON winners(round_id);
  CREATE INDEX IF NOT EXISTS idx_winners_player ON winners(player);

  -- Meta key/value store (e.g. last processed block)
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── Prepared statements ─────────────────────────────────────────────────────

const stmts = {
  // rounds
  upsertRound: db.prepare(`
    INSERT INTO rounds (round_id, start_time, end_time, prize_pool_eth, carry_in_eth, status)
    VALUES (@roundId, @startTime, @endTime, @prizePoolEth, @carryInEth, 'open')
    ON CONFLICT(round_id) DO UPDATE SET
      start_time     = excluded.start_time,
      end_time       = excluded.end_time,
      prize_pool_eth = excluded.prize_pool_eth,
      carry_in_eth   = excluded.carry_in_eth
  `),

  setRoundStatus: db.prepare(`
    UPDATE rounds SET status = @status WHERE round_id = @roundId
  `),

  setRoundDrawing: db.prepare(`
    UPDATE rounds SET status = 'drawing', trigger_tx = @txHash WHERE round_id = @roundId
  `),

  setRoundVrfPending: db.prepare(`
    UPDATE rounds SET status = 'vrf_pending' WHERE round_id = @roundId
  `),

  setRoundWinningNums: db.prepare(`
    UPDATE rounds
    SET winning_nums = @nums, status = 'counting'
    WHERE round_id = @roundId
  `),

  setRoundDistributing: db.prepare(`
    UPDATE rounds SET status = 'distributing' WHERE round_id = @roundId
  `),

  finalizeRound: db.prepare(`
    UPDATE rounds
    SET status = 'finalized', carry_out_eth = @carryOutEth, finalize_tx = @txHash
    WHERE round_id = @roundId
  `),

  updateTicketCount: db.prepare(`
    UPDATE rounds SET total_tickets = @count WHERE round_id = @roundId
  `),

  getRound: db.prepare(`SELECT * FROM rounds WHERE round_id = ?`),

  getRounds: db.prepare(`
    SELECT * FROM rounds ORDER BY round_id DESC LIMIT ? OFFSET ?
  `),

  getRecentFinalized: db.prepare(`
    SELECT * FROM rounds WHERE status = 'finalized' ORDER BY round_id DESC LIMIT ?
  `),

  // tickets
  insertTicket: db.prepare(`
    INSERT OR IGNORE INTO tickets (round_id, player, numbers, ticket_index, tx_hash)
    VALUES (@roundId, @player, @numbers, @ticketIndex, @txHash)
  `),

  getTicketsByRound: db.prepare(`
    SELECT * FROM tickets WHERE round_id = ? ORDER BY ticket_index
  `),

  getTicketsByPlayer: db.prepare(`
    SELECT t.*, r.winning_nums, r.status as round_status
    FROM tickets t
    JOIN rounds r ON t.round_id = r.round_id
    WHERE LOWER(t.player) = LOWER(?)
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `),

  // winners
  insertWinner: db.prepare(`
    INSERT OR IGNORE INTO winners (round_id, player, ticket_index, match_count, prize_eth, tx_hash)
    VALUES (@roundId, @player, @ticketIndex, @matchCount, @prizeEth, @txHash)
  `),

  getWinnersByRound: db.prepare(`
    SELECT * FROM winners WHERE round_id = ? ORDER BY match_count DESC
  `),

  getWinsByPlayer: db.prepare(`
    SELECT w.*, r.winning_nums, r.end_time
    FROM winners w
    JOIN rounds r ON w.round_id = r.round_id
    WHERE LOWER(w.player) = LOWER(?)
    ORDER BY w.created_at DESC
    LIMIT ? OFFSET ?
  `),

  totalWonByPlayer: db.prepare(`
    SELECT COALESCE(SUM(CAST(prize_eth AS REAL)), 0) as total
    FROM winners WHERE LOWER(player) = LOWER(?)
  `),

  // stats
  globalStats: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM rounds WHERE status = 'finalized') as total_rounds,
      (SELECT COUNT(*) FROM winners)                           as total_winners,
      (SELECT COUNT(*) FROM tickets)                          as total_tickets,
      (SELECT COALESCE(SUM(CAST(prize_eth AS REAL)), 0) FROM winners) as total_paid_eth
  `),

  // meta
  getMeta: db.prepare(`SELECT value FROM meta WHERE key = ?`),
  setMeta: db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`),
};

// Public API

module.exports = {
  // rounds
  upsertRound: (o) => stmts.upsertRound.run(o),
  setRoundStatus: (roundId, status) => stmts.setRoundStatus.run({ roundId, status }),
  setRoundDrawing: (roundId, txHash) => stmts.setRoundDrawing.run({ roundId, txHash }),
  setRoundVrfPending: (roundId) => stmts.setRoundVrfPending.run({ roundId }),
  setRoundWinningNums: (roundId, nums) =>
    stmts.setRoundWinningNums.run({ roundId, nums: JSON.stringify(nums) }),
  setRoundDistributing: (roundId) => stmts.setRoundDistributing.run({ roundId }),
  finalizeRound: (roundId, carryOutEth, txHash = null) =>
    stmts.finalizeRound.run({ roundId, carryOutEth, txHash }),
  updateTicketCount: (roundId, count) => stmts.updateTicketCount.run({ roundId, count }),

  getRound:   (roundId) => stmts.getRound.get(roundId),
  getRounds:  (limit = 20, offset = 0) => stmts.getRounds.all(limit, offset),
  getRecentFinalized: (limit = 10) => stmts.getRecentFinalized.all(limit),

  // tickets
  insertTicket: (o) => stmts.insertTicket.run({
    ...o,
    numbers: JSON.stringify(o.numbers),
  }),
  getTicketsByRound:  (roundId) => stmts.getTicketsByRound.all(roundId),
  getTicketsByPlayer: (addr, limit = 50, offset = 0) =>
    stmts.getTicketsByPlayer.all(addr, limit, offset),

  // winners
  insertWinner: (o) => stmts.insertWinner.run(o),
  getWinnersByRound:  (roundId) => stmts.getWinnersByRound.all(roundId),
  getWinsByPlayer:    (addr, limit = 50, offset = 0) =>
    stmts.getWinsByPlayer.all(addr, limit, offset),
  totalWonByPlayer:   (addr) => stmts.totalWonByPlayer.get(addr)?.total ?? 0,

  //stats 
  globalStats: () => stmts.globalStats.get(),

  // meta
  getMeta: (key) => stmts.getMeta.get(key)?.value,
  setMeta: (key, value) => stmts.setMeta.run(key, String(value)),

  // Raw db for transactions
  db,
};
