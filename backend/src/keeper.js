"use strict";
/**
 * Keeper – autonomous bot that runs 24/7 to:
 *
 *  1. Trigger the draw exactly when the round's 5-minute window expires.
 *  2. Wait for Chainlink VRF to fulfil (DrawCompleted event).
 *  3. Auto-count winners (countRoundWinners in batches).
 *  4. Auto-distribute prizes (distributeRound in batches).
 *  5. Persist all state to SQLite so the history is always queryable.
 *  6. Broadcast real-time updates to connected WebSocket clients.
 *
 * Round lifecycle (on-chain):
 *   open ──triggerDraw()──► drawing ──VRF──► vrf_pending ──DrawCompleted──►
 *   counting ──countRoundWinners()──► distributing ──distributeRound()──► finalized
 *
 * Note: The contract opens Round N+1 inside triggerDraw(), so the new
 * countdown starts immediately – there is no dead time between rounds.
 * The backend processes Round N's prizes while Round N+1 is already live.
 */

const { ethers } = require("ethers");
const db         = require("./db");

// How many tickers to process per batch call (tune based on block gas limit)
const BATCH = 200n;

// Seconds to add after round endTime before we trigger (safety buffer for clock drift)
const TRIGGER_BUFFER_SECS = 3;

// Retry delays
const RETRY_SHORT = 15_000;  // 15 s  – transient errors
const RETRY_LONG  = 60_000;  // 60 s  – persistent errors

class Keeper {
  /**
   * @param {import('ethers').Contract} ro  Read-only contract (provider)
   * @param {import('ethers').Contract} rw  Read-write contract (signer)
   * @param {Function} broadcast            Sends a JSON message to all WS clients
   */
  constructor(ro, rw, broadcast) {
    this.ro        = ro;
    this.rw        = rw;
    this.broadcast = broadcast;
    this._drawTimer = null;
    this._processing = new Set(); // roundIds currently being processed
  }

  // Bootstrap

  async start() {
    console.log("[keeper] Starting…");
    await this._syncOnStart();
    this._attachEvents();
    await this._scheduleNextDraw();
    console.log("[keeper] Running.");
  }

  /**
   * On server start, sync the last 20 rounds from chain → DB so history
   * is populated even after a server restart.
   */
  async _syncOnStart() {
    try {
      const info  = await this.ro.getCurrentRound();
      const curId = Number(info.roundId);

      for (let id = Math.max(1, curId - 19); id <= curId; id++) {
        try {
          const status  = await this.ro.getRoundStatus(id);
          const tickets = Number(status.totalTickets);

          // Ensure round row exists
          const startTime = id === curId ? Number(info.startTime) : 0;
          const endTime   = id === curId ? Number(info.endTime)   : 0;
          db.upsertRound({
            roundId:      id,
            startTime,
            endTime,
            prizePoolEth: ethers.formatEther(status.prizePool),
            carryInEth:   "0",
          });
          db.updateTicketCount(id, tickets);

          if (status.drawCompleted) {
            const nums = await this.ro.getWinningNumbers(id);
            db.setRoundWinningNums(id, nums.map(Number));
          }
          if (status.distributeDone) {
            db.finalizeRound(id, ethers.formatEther(status.carryOut));
          }

          // If an in-progress round needs processing, kick it off
          if (status.drawCompleted && !status.countDone && !this._processing.has(id)) {
            this._processRound(id).catch(console.error);
          } else if (status.countDone && !status.distributeDone && !this._processing.has(id)) {
            this._processRound(id).catch(console.error);
          }
        } catch { /* skip inaccessible rounds */ }
      }

      console.log(`[keeper] Synced rounds up to #${curId}`);
    } catch (err) {
      console.error("[keeper] _syncOnStart error:", err.message);
    }
  }

  // Event listeners

  _attachEvents() {
    const { ro } = this;

    //A new round just opened
    ro.on("RoundStarted", (roundId, endTime, openingPool) => {
      const id  = Number(roundId);
      const end = Number(endTime);
      console.log(`[event] RoundStarted #${id}, ends ${new Date(end * 1000).toISOString()}`);

      db.upsertRound({
        roundId:      id,
        startTime:    Math.floor(Date.now() / 1000),
        endTime:      end,
        prizePoolEth: ethers.formatEther(openingPool),
        carryInEth:   ethers.formatEther(openingPool),
      });

      this.broadcast({
        type:    "round:started",
        roundId: id,
        endTime: end,
        prizePool: ethers.formatEther(openingPool),
      });

      // Schedule the draw for this new round
      this._scheduleDraw(id, end);
    });

    //A ticket was purchased
    ro.on("TicketPurchased", (roundId, player, numbers, ticketIndex, ev) => {
      const id = Number(roundId);
      db.insertTicket({
        roundId:     id,
        player,
        numbers:     numbers.map(Number),
        ticketIndex: Number(ticketIndex),
        txHash:      ev.log?.transactionHash ?? null,
      });
      db.updateTicketCount(id, Number(ticketIndex) + 1);

      this.broadcast({
        type:        "ticket:purchased",
        roundId:     id,
        player,
        numbers:     numbers.map(Number),
        ticketIndex: Number(ticketIndex),
      });
    });

    // VRF delivered the winning numbers
    ro.on("DrawCompleted", (roundId, winningNums) => {
      const id   = Number(roundId);
      const nums = winningNums.map(Number);
      console.log(`[event] DrawCompleted #${id}  winning: [${nums.join(",")}]`);

      db.setRoundWinningNums(id, nums);

      this.broadcast({ type: "round:draw_complete", roundId: id, winningNumbers: nums });

      // Auto-process: count winners + distribute prizes
      if (!this._processing.has(id)) {
        this._processRound(id).catch(console.error);
      }
    });

    // Counting finished
    ro.on("CountingDone", (roundId, tierCounts) => {
      const id     = Number(roundId);
      const counts = tierCounts.map(Number);
      console.log(`[event] CountingDone #${id}  tiers: [${counts.join(",")}]`);
      db.setRoundDistributing(id);
      this.broadcast({ type: "round:counting_done", roundId: id, tierCounts: counts });
    });

    // A winner was paid 
    ro.on("PrizeAwarded", (roundId, player, amount, matchCount, ev) => {
      const id = Number(roundId);
      db.insertWinner({
        roundId:     id,
        player,
        ticketIndex: null,
        matchCount:  Number(matchCount),
        prizeEth:    ethers.formatEther(amount),
        txHash:      ev.log?.transactionHash ?? null,
      });
      this.broadcast({
        type:       "winner:awarded",
        roundId:    id,
        player,
        prizeEth:   ethers.formatEther(amount),
        matchCount: Number(matchCount),
      });
    });

    // Round fully finalized
    ro.on("RoundFinalized", (roundId, carryOut, ev) => {
      const id = Number(roundId);
      console.log(`[event] RoundFinalized #${id}  carryOut: ${ethers.formatEther(carryOut)} ETH`);
      db.finalizeRound(id, ethers.formatEther(carryOut), ev.log?.transactionHash ?? null);
      this._processing.delete(id);
      this.broadcast({
        type:        "round:finalized",
        roundId:     id,
        carryOutEth: ethers.formatEther(carryOut),
      });
    });
  }

  //Draw scheduling

  async _scheduleNextDraw() {
    try {
      const info = await this.ro.getCurrentRound();
      this._scheduleDraw(Number(info.roundId), Number(info.endTime));
    } catch (err) {
      console.error("[keeper] _scheduleNextDraw error:", err.message);
      setTimeout(() => this._scheduleNextDraw(), RETRY_SHORT);
    }
  }

  _scheduleDraw(roundId, endTime) {
    clearTimeout(this._drawTimer);

    const now       = Math.floor(Date.now() / 1000);
    const delaySecs = Math.max(0, endTime - now + TRIGGER_BUFFER_SECS);
    const delayMs   = delaySecs * 1000;

    console.log(`[keeper] Draw for round #${roundId} scheduled in ${delaySecs}s`);

    this._drawTimer = setTimeout(async () => {
      await this._triggerDraw(roundId);
    }, delayMs);
  }

  //Trigger draw 

  async _triggerDraw(expectedRoundId, attempt = 1) {
    try {
      const canTrigger = await this.ro.canTriggerDraw();
      if (!canTrigger) {
        console.log("[keeper] canTriggerDraw() returned false – skipping");
        return;
      }

      console.log(`[keeper] Triggering draw for round #${expectedRoundId}…`);
      db.setRoundDrawing(expectedRoundId, null);
      this.broadcast({ type: "round:drawing", roundId: expectedRoundId });

      const tx   = await this.rw.triggerDraw();
      const rcpt = await tx.wait();

      db.setRoundDrawing(expectedRoundId, rcpt.hash);
      db.setRoundVrfPending(expectedRoundId);
      console.log(`[keeper] triggerDraw confirmed: ${rcpt.hash}`);
      this.broadcast({ type: "round:vrf_pending", roundId: expectedRoundId, txHash: rcpt.hash });

    } catch (err) {
      const msg = err?.reason || err?.shortMessage || err?.message || "unknown";
      console.error(`[keeper] triggerDraw attempt ${attempt} failed:`, msg);

      if (attempt < 5) {
        const delay = RETRY_SHORT * attempt;
        console.log(`[keeper] Retrying in ${delay / 1000}s…`);
        setTimeout(() => this._triggerDraw(expectedRoundId, attempt + 1), delay);
      } else {
        console.error("[keeper] triggerDraw gave up after 5 attempts.");
      }
    }
  }

  // Process round (count + distribute in batches)

  async _processRound(roundId, attempt = 1) {
    if (this._processing.has(roundId)) return; // already in flight
    this._processing.add(roundId);

    console.log(`[keeper] Processing round #${roundId}…`);
    this.broadcast({ type: "round:processing", roundId });

    try {
      // Phase 1: count winners
      let status = await this.ro.getRoundStatus(roundId);

      while (!status.countDone) {
        console.log(`[keeper]   counting… (${status.countIdx}/${status.totalTickets})`);
        db.setRoundStatus(roundId, "counting");

        const tx = await this.rw.countRoundWinners(roundId, BATCH);
        await tx.wait();
        status = await this.ro.getRoundStatus(roundId);
      }

      // Phase 2: distribute prizes
      while (!status.distributeDone) {
        console.log(`[keeper]   distributing… (${status.distributeIdx}/${status.totalTickets})`);
        db.setRoundDistributing(roundId);

        const tx = await this.rw.distributeRound(roundId, BATCH);
        await tx.wait();
        status = await this.ro.getRoundStatus(roundId);
      }

      console.log(`[keeper] Round #${roundId} fully processed.`);
      // RoundFinalized event will handle the final DB write and cleanup

    } catch (err) {
      this._processing.delete(roundId);
      const msg = err?.reason || err?.shortMessage || err?.message || "unknown";
      console.error(`[keeper] processRound #${roundId} attempt ${attempt} failed:`, msg);

      if (attempt < 10) {
        const delay = Math.min(RETRY_LONG * attempt, 10 * 60_000); // cap at 10 min
        console.log(`[keeper] Retrying round #${roundId} in ${delay / 1000}s…`);
        setTimeout(() => this._processRound(roundId, attempt + 1), delay);
      } else {
        console.error(`[keeper] Gave up processing round #${roundId}.`);
        db.setRoundStatus(roundId, "error");
      }
    }
  }
}

module.exports = Keeper;
