"use strict";
require("dotenv").config();

const http    = require("http");
const express = require("express");
const cors    = require("cors");
const { WebSocketServer } = require("ws");
const { ethers }          = require("ethers");

const { connect, get } = require("./contract");
const db               = require("./db");
const Keeper           = require("./keeper");
const roundsRouter     = require("./routes/rounds");
const playersRouter    = require("./routes/players");

//Express app
const app = express();

app.use(cors({
  origin: (process.env.FRONTEND_URL || "http://localhost:3000").split(","),
  methods: ["GET"],
}));
app.use(express.json());

// REST Routes

// /api/rounds  + /api/rounds/history + /api/rounds/:id + /api/rounds/:id/winners
app.use("/api/rounds",  roundsRouter);

// /api/players/:address/wins  + /api/players/:address/tickets
app.use("/api/players", playersRouter);

// GET /api/stats
app.get("/api/stats", (req, res) => {
  res.json(db.globalStats());
});

// GET /api/current-round
// Live round data read directly from the chain (accurate for countdown + pool).
app.get("/api/current-round", async (req, res) => {
  try {
    const { contract } = get();
    const [info, secs] = await Promise.all([
      contract.getCurrentRound(),
      contract.secondsUntilDraw(),
    ]);
    res.json({
      roundId:       Number(info.roundId),
      startTime:     Number(info.startTime),
      endTime:       Number(info.endTime),
      prizePool:     ethers.formatEther(info.prizePool),
      totalTickets:  Number(info.totalTickets),
      drawRequested: info.drawRequested,
      drawCompleted: info.drawCompleted,
      secsLeft:      Number(secs),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Health check
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

//HTTP + WebSocket server
const PORT   = Number(process.env.PORT || 4000);
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: "/ws" });

const clients = new Set();

wss.on("connection", (ws, req) => {
  clients.add(ws);
  console.log(`[ws] Client connected (total: ${clients.size})`);

  // Send current round immediately on connect
  get().contract?.getCurrentRound().then((info) => {
    const msg = JSON.stringify({
      type:          "round:current",
      roundId:       Number(info.roundId),
      endTime:       Number(info.endTime),
      prizePool:     ethers.formatEther(info.prizePool),
      totalTickets:  Number(info.totalTickets),
      drawRequested: info.drawRequested,
    });
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }).catch(() => {});

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error("[ws] Client error:", err.message);
    clients.delete(ws);
  });
});

/**
 * Broadcast a JSON event to all connected WebSocket clients.
 * @param {object} payload
 */
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

// Broadcast the live countdown every second to all clients
setInterval(async () => {
  try {
    const { contract } = get();
    if (!contract) return;
    const secs = await contract.secondsUntilDraw();
    const s = Number(secs);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    process.stdout.write(`\r[timer] Round closes in ${mm}:${ss}   `);
    broadcast({ type: "round:tick", secsLeft: s });
  } catch { /* ignore during reconnect */ }
}, 1_000);

// Start the server and keeper bot
async function main() {
  // Connect to blockchain
  const { contract: ro, rw } = connect();

  // Start keeper bot
  const keeper = new Keeper(ro, rw, broadcast);
  keeper.start().catch((err) => {
    console.error("[keeper] Fatal start error:", err);
    process.exit(1);
  });

  // Start HTTP server
  server.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    console.log(`[server] WebSocket at  ws://localhost:${PORT}/ws`);
    console.log(`[server] REST API at   http://localhost:${PORT}/api`);
  });
}

main().catch((err) => {
  console.error("[server] Fatal:", err);
  process.exit(1);
});
