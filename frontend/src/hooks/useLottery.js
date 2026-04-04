"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const WS  = process.env.NEXT_PUBLIC_WS_URL  || "ws://localhost:4000/ws";

export function useLottery({ token, refreshUser } = {}) {
  const [round,      setRound]      = useState(null);
  const [secsLeft,   setSecsLeft]   = useState(0);
  const [myTickets,  setMyTickets]  = useState([]);
  const [myPrize,    setMyPrize]    = useState("0");  // pending ETH on-chain
  const [history,    setHistory]    = useState([]);
  const [pendingTx,  setPendingTx]  = useState(null);
  const [txError,    setTxError]    = useState(null);
  const [txSuccess,  setTxSuccess]  = useState(null);
  const wsRef = useRef(null);

  function authHeaders() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchRound = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/current-round`).then((r) => r.json());
      setRound(r);
      setSecsLeft(r.secsLeft ?? 0);
    } catch { /* server not ready */ }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const { rounds } = await fetch(`${API}/api/rounds/history?limit=10`).then((r) => r.json());
      setHistory(rounds || []);
    } catch { /* ignore */ }
  }, []);

  const fetchMyTickets = useCallback(async (roundId) => {
    if (!token || !roundId) return;
    try {
      const rows = await fetch(`${API}/api/tickets/mine?limit=100`, {
        headers: authHeaders(),
      }).then((r) => r.json());
      const mine = (Array.isArray(rows) ? rows : [])
        .filter((t) => t.round_id === roundId)
        .map((t) => ({
          ticketIndex: t.ticket_index,
          numbers:     typeof t.numbers === "string" ? JSON.parse(t.numbers) : t.numbers,
        }));
      setMyTickets(mine);
    } catch { /* ignore */ }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPendingPrize = useCallback(async () => {
    if (!token) return;
    try {
      const { pendingEth } = await fetch(`${API}/api/prizes/pending`, {
        headers: authHeaders(),
      }).then((r) => r.json());
      setMyPrize(pendingEth ?? "0");
    } catch { /* ignore */ }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let ws;
    let retryTimer;

    function open() {
      ws = new WebSocket(WS);
      wsRef.current = ws;

      ws.onmessage = ({ data }) => {
        try { handleWsMsg(JSON.parse(data)); } catch { /* ignore */ }
      };
      ws.onerror  = () => {};
      ws.onclose  = () => { retryTimer = setTimeout(open, 3_000); };
    }

    open();
    return () => { clearTimeout(retryTimer); ws?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleWsMsg(msg) {
    switch (msg.type) {
      case "round:tick":
        setSecsLeft(msg.secsLeft);
        break;

      case "round:current":
      case "round:started":
        setRound((p) => ({
          ...(p || {}),
          roundId:       msg.roundId,
          endTime:       msg.endTime,
          prizePool:     msg.prizePool ?? p?.prizePool ?? "0",
          totalTickets:  msg.totalTickets ?? p?.totalTickets ?? 0,
          drawRequested: false,
          drawCompleted: false,
        }));
        break;

      case "round:drawing":
      case "round:vrf_pending":
        setRound((p) => p ? { ...p, drawRequested: true } : p);
        break;

      case "round:draw_complete":
        setRound((p) => p ? {
          ...p, drawCompleted: true, winningNumbers: msg.winningNumbers,
        } : p);
        if (token) fetchPendingPrize();
        break;

      case "ticket:purchased":
        setRound((p) => p ? { ...p, totalTickets: (p.totalTickets || 0) + 1 } : p);
        break;

      case "round:finalized":
        fetchHistory();
        fetchRound();
        if (token) { fetchPendingPrize(); refreshUser?.(); }
        break;
    }
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchRound();
    fetchHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (token) fetchPendingPrize();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (token && round?.roundId) fetchMyTickets(round.roundId);
  }, [token, round?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ─────────────────────────────────────────────────────────────────

  const buyTicket = useCallback(async (numbers) => {
    setTxError(null);
    setTxSuccess(null);
    setPendingTx("Buy Ticket");
    try {
      const r = await fetch(`${API}/api/tickets/buy`, {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify({ numbers }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Purchase failed");

      setTxSuccess("Ticket purchased!");
      refreshUser?.();
      if (round?.roundId) fetchMyTickets(round.roundId);
    } catch (err) {
      setTxError(err.message);
    } finally {
      setPendingTx(null);
    }
  }, [token, round?.roundId, refreshUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const claimPrize = useCallback(async () => {
    setTxError(null);
    setTxSuccess(null);
    setPendingTx("Claim Prize");
    try {
      const r = await fetch(`${API}/api/prizes/claim`, {
        method:  "POST",
        headers: authHeaders(),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Claim failed");

      setTxSuccess(`Claimed! ${data.creditsAdded} credit(s) added to your balance.`);
      setMyPrize("0");
      refreshUser?.();
    } catch (err) {
      setTxError(err.message);
    } finally {
      setPendingTx(null);
    }
  }, [token, refreshUser]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    round, secsLeft, myTickets, myPrize, history,
    pendingTx, txError, txSuccess, setTxError, setTxSuccess,
    buyTicket, claimPrize,
    fetchRound, fetchHistory,
  };
}
