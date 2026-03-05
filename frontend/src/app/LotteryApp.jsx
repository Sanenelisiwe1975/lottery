"use client";
import { useEffect } from "react";
import { useLottery } from "../hooks/useLottery";
import Header       from "../components/Header";
import RoundCard    from "../components/RoundCard";
import NumberPicker from "../components/NumberPicker";
import ClaimPanel   from "../components/ClaimPanel";
import RoundHistory from "../components/RoundHistory";
import AdminPanel   from "../components/AdminPanel";
import styles from "./LotteryApp.module.css";

//Toast notification
function Toast({ msg, type, onClose }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [msg, onClose]);

  if (!msg) return null;
  return (
    <div className="toast-wrap">
      <div className={`toast toast-${type}`}>
        <span style={{ flex: 1 }}>{msg}</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "1rem" }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

//Main App
export default function LotteryApp() {
  const {
    wallet, connectWallet, disconnectWallet,
    round, secsLeft, myPrize, myTickets, history, ownerFees, isOwner,
    pendingTx, txError, txSuccess, setTxError, setTxSuccess,
    buyTicket, claimPrize, withdrawFees,
  } = useLottery();

  const roundOpen = round && !round.drawRequested;
  const noWallet  = !wallet;

  return (
    <div className={styles.page}>
      <Header
        wallet={wallet}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
      />

      <main className={styles.main}>
        {/*No wallet */}
        {noWallet && (
          <div className={styles.hero}>
            <div className={styles.heroBalls}>
              {[7, 14, 21, 28, 35, 42, 49].map((n) => (
                <span key={n} className={styles.heroBall}>{n}</span>
              ))}
            </div>
            <h1 className={styles.heroTitle}>Provably Fair Lottery</h1>
            <p className={styles.heroSub}>
              Pick 7 numbers · Chainlink VRF draw every 5 minutes · Win up to 30% of the pool
            </p>

            {/* Live round timer – visible before wallet connection */}
            {round && (
              <div className={styles.heroTimer}>
                {round.drawRequested ? (
                  <span className={styles.heroTimerLabel}>⏳ Drawing in progress…</span>
                ) : (
                  <>
                    <span className={styles.heroTimerLabel}>
                      Round #{round.roundId} · Next draw in
                    </span>
                    <div className={styles.heroCountdown}>
                      <span className={styles.heroTimeNum}>
                        {String(Math.floor((secsLeft || 0) / 60)).padStart(2, "0")}
                      </span>
                      <span className={styles.heroColon}>:</span>
                      <span className={styles.heroTimeNum}>
                        {String((secsLeft || 0) % 60).padStart(2, "0")}
                      </span>
                    </div>
                    <span className={styles.heroTimerSub}>
                      Prize pool: {round.prizePool} ETH · {round.totalTickets} tickets
                    </span>
                  </>
                )}
              </div>
            )}

            <button className={styles.heroConnect} onClick={connectWallet}>
              Connect Wallet to Play
            </button>

            {/*Prize table preview */}
            <div className={styles.prizePreview}>
              {[
                ["2 balls", "5%"], ["3 balls", "10%"], ["4 balls", "15%"],
                ["5 balls", "20%"], ["6 balls", "20%"], ["7 balls", "30%"],
              ].map(([m, p]) => (
                <div key={m} className={styles.prizeRow}>
                  <span>{m}</span><span className={styles.pct}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Wallet connected */}
        {wallet && (
          <div className={styles.grid}>
            {/*Left column*/}
            <div className={styles.left}>
              <RoundCard
                round={round}
                secsLeft={secsLeft}
              />

              <NumberPicker
                onBuy={buyTicket}
                pendingTx={pendingTx}
                disabled={!roundOpen}
              />

              {/* Pending tx indicator */}
              {pendingTx && (
                <div className={styles.txBanner}>
                  <div className={styles.txSpinner} />
                  <span>{pendingTx}…</span>
                </div>
              )}
            </div>

            {/*Right column */}
            <div className={styles.right}>
              {isOwner && (
                <AdminPanel
                  ownerFees={ownerFees}
                  onWithdrawFees={withdrawFees}
                  pendingTx={pendingTx}
                />
              )}

              <ClaimPanel
                myPrize={myPrize}
                myTickets={myTickets}
                onClaim={claimPrize}
                pendingTx={pendingTx}
              />

              <RoundHistory history={history} />
            </div>
          </div>
        )}
      </main>

      {/*Toast notifications*/}
      <Toast
        msg={txSuccess}
        type="success"
        onClose={() => setTxSuccess(null)}
      />
      <Toast
        msg={txError}
        type="error"
        onClose={() => setTxError(null)}
      />
    </div>
  );
}
