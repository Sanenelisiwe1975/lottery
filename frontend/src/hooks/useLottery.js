"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESSES } from "../constants";

// Backend endpoints
// Set NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL in lottery/frontend/.env.local
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const WS  = process.env.NEXT_PUBLIC_WS_URL  || "ws://localhost:4000/ws";

const fmt = (wei) => parseFloat(ethers.formatEther(wei)).toFixed(4);

function getContract(signerOrProvider, chainId) {
  const address = CONTRACT_ADDRESSES[chainId];
  if (!address || address.startsWith("0xYOUR")) return null;
  return new ethers.Contract(address, ABI, signerOrProvider);
}

export function useLottery() {
  const [wallet,    setWallet]    = useState(null);
  const [round,     setRound]     = useState(null);   // current round (API + WS)
  const [secsLeft,  setSecsLeft]  = useState(0);      // live countdown from WS ticks
  const [myPrize,   setMyPrize]   = useState("0");
  const [myTickets, setMyTickets] = useState([]);
  const [history,   setHistory]   = useState([]);     // winner history from backend DB
  const [ownerFees, setOwnerFees] = useState("0");
  const [isOwner,   setIsOwner]   = useState(false);
  const [pendingTx, setPendingTx] = useState(null);
  const [txError,   setTxError]   = useState(null);
  const [txSuccess, setTxSuccess] = useState(null);
  const wsRef = useRef(null);

  //Connect MetaMask
  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      alert("MetaMask not found. Please install from https://metamask.io");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer  = await provider.getSigner();
      const address = await signer.getAddress();
      const network = await provider.getNetwork();
      setWallet({ address, chainId: Number(network.chainId), provider, signer });
    } catch (err) {
      console.error("Connect error:", err);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setWallet(null);
    setMyPrize("0");
    setMyTickets([]);
    setIsOwner(false);
  }, []);

  // Fetch current round from backend
  const fetchRound = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/current-round`).then((res) => res.json());
      setRound(r);
      setSecsLeft(r.secsLeft ?? 0);
    } catch { /* server not ready yet */ }
  }, []);

  // Fetch winner history from backend Db
  const fetchHistory = useCallback(async () => {
    try {
      const { rounds } = await fetch(`${API}/api/rounds/history?limit=10`).then((r) => r.json());
      setHistory(rounds || []);
    } catch { /* ignore */ }
  }, []);

  // Fetch player-specific chain data
  const fetchPlayerData = useCallback(async (w) => {
    if (!w) return;
    const { provider, address, chainId } = w;
    const ro = getContract(provider, chainId);
    if (!ro) return;
    try {
      const [prize, ownerAddr, fees] = await Promise.all([
        ro.pendingWithdrawals(address),
        ro.owner(),
        ro.pendingOwnerFees(),
      ]);
      setMyPrize(fmt(prize));
      setOwnerFees(fmt(fees));
      setIsOwner(ownerAddr.toLowerCase() === address.toLowerCase());
    } catch { /* ignore */ }
  }, []);

  // Fetch my tickets from backend DB
  const fetchMyTickets = useCallback(async (w, roundId) => {
    if (!w || !roundId) return;
    try {
      const { tickets } = await fetch(
        `${API}/api/players/${w.address}/tickets?limit=100`
      ).then((r) => r.json());
      const mine = (tickets || [])
        .filter((t) => t.round_id === roundId)
        .map((t) => ({ ticketIndex: t.ticket_index, numbers: t.numbers }));
      setMyTickets(mine);
    } catch { /* ignore */ }
  }, []);

  // WebSocket – real-time round events
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
        break;

      case "ticket:purchased":
        setRound((p) => p ? { ...p, totalTickets: (p.totalTickets || 0) + 1 } : p);
        break;

      case "round:finalized":
        fetchHistory();
        fetchRound();
        break;

      case "winner:awarded":
        if (
          wsRef.__wallet &&
          msg.player?.toLowerCase() === wsRef.__wallet?.toLowerCase()
        ) {
          // The player's prize updated – refresh on-chain balance
          // We store wallet address in a ref to avoid stale closure issues
        }
        break;
    }
  }

  // Keep wallet address accessible inside WS handler via ref
  useEffect(() => { wsRef.__wallet = wallet?.address ?? null; }, [wallet]);

  // Bootstrap: load round + history on mount (no wallet required)
  useEffect(() => {
    fetchRound();
    fetchHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when wallet connects
  useEffect(() => {
    if (!wallet) return;
    fetchPlayerData(wallet);
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh my tickets whenever round changes
  useEffect(() => {
    if (wallet && round) fetchMyTickets(wallet, round.roundId);
  }, [wallet?.address, round?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh prize balance after VRF finalized
  useEffect(() => {
    if (wallet && round?.drawCompleted) fetchPlayerData(wallet);
  }, [round?.drawCompleted]); // eslint-disable-line react-hooks/exhaustive-deps

  // MetaMask listeners
  useEffect(() => {
    if (!window.ethereum) return;
    const onChain   = () => window.location.reload();
    const onAccount = (accs) => { if (accs.length === 0) disconnectWallet(); else connectWallet(); };
    window.ethereum.on("chainChanged",    onChain);
    window.ethereum.on("accountsChanged", onAccount);
    return () => {
      window.ethereum.removeListener("chainChanged",    onChain);
      window.ethereum.removeListener("accountsChanged", onAccount);
    };
  }, [connectWallet, disconnectWallet]);

  //Transaction wrapper
  const send = useCallback(async (label, fn) => {
    setTxError(null);
    setTxSuccess(null);
    setPendingTx(label);
    try {
      const tx = await fn();
      await tx.wait();
      setTxSuccess(`✓ ${label} confirmed!`);
      if (wallet) {
        await fetchPlayerData(wallet);
        await fetchMyTickets(wallet, round?.roundId);
      }
    } catch (err) {
      const msg = err?.reason || err?.shortMessage || err?.message || "Transaction failed";
      setTxError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
    } finally {
      setPendingTx(null);
    }
  }, [wallet, round?.roundId, fetchPlayerData, fetchMyTickets]);

  // Public actions (wallet-signed)
  // NOTE: triggerDraw / countWinners / distributeRound are now handled automatically
  // by the backend keeper bot. They no longer need manual buttons in the UI.

  const buyTicket = (numbers) => {
    const ro = getContract(wallet.signer, wallet.chainId);
    return send("Buy Ticket", () => ro.buyTicket(numbers, { value: ethers.parseEther("0.01") }));
  };

  const claimPrize = () => {
    const ro = getContract(wallet.signer, wallet.chainId);
    return send("Claim Prize", () => ro.withdrawPrize());
  };

  const withdrawFees = () => {
    const ro = getContract(wallet.signer, wallet.chainId);
    return send("Withdraw Owner Fees", () => ro.withdrawOwnerFees());
  };

  return {
    wallet, connectWallet, disconnectWallet,
    round, secsLeft, myPrize, myTickets, history, ownerFees, isOwner,
    pendingTx, txError, txSuccess, setTxError, setTxSuccess,
    buyTicket, claimPrize, withdrawFees,
    fetchRound, fetchHistory,
  };
}
