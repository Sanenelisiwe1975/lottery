"use client";
import { useEffect, useState } from "react";
import { useAuth }       from "../hooks/useAuth";
import { useLottery }    from "../hooks/useLottery";
import Header            from "../components/Header";
import AuthModal         from "../components/AuthModal";
import BuyCreditsModal    from "../components/BuyCreditsModal";
import MobileMoneyModal  from "../components/MobileMoneyModal";
import RoundCard         from "../components/RoundCard";
import NumberPicker      from "../components/NumberPicker";
import ClaimPanel        from "../components/ClaimPanel";
import RoundHistory      from "../components/RoundHistory";
import styles from "./LotteryApp.module.css";

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

export default function LotteryApp() {
  const { token, user, loading, login, register, logout, refreshUser, isLoggedIn } = useAuth();
  const {
    round, secsLeft, myTickets, myPrize, history,
    pendingTx, txError, txSuccess, setTxError, setTxSuccess,
    buyTicket, claimPrize,
  } = useLottery({ token, refreshUser });

  const [showCredits,      setShowCredits]      = useState(false);
  const [showMobileMoney,  setShowMobileMoney]  = useState(false);

  const roundOpen = round && !round.drawRequested;

  // While restoring session from localStorage, show skeleton to avoid flash
  if (loading) {
    return (
      <div className={styles.page}>
        <Header user={null} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header
        user={user}
        onLogout={logout}
        onAddCredits={() => setShowCredits(true)}
        onMobileMoney={() => setShowMobileMoney(true)}
      />

      <main className={styles.main}>
        {/* ── Not logged in: show live stats + auth modal behind ── */}
        {!isLoggedIn && (
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

        {/* ── Logged in ── */}
        {isLoggedIn && (
          <div className={styles.grid}>
            <div className={styles.left}>
              <RoundCard round={round} secsLeft={secsLeft} />

              <NumberPicker
                onBuy={buyTicket}
                pendingTx={pendingTx}
                disabled={!roundOpen}
                credits={user?.credits ?? 0}
              />

              {pendingTx && (
                <div className={styles.txBanner}>
                  <div className={styles.txSpinner} />
                  <span>{pendingTx}…</span>
                </div>
              )}
            </div>

            <div className={styles.right}>
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

      {/* ── Auth modal: shown when not logged in ── */}
      {!isLoggedIn && (
        <AuthModal onLogin={login} onRegister={register} />
      )}

      {/* ── Buy credits modal (Stripe card) ── */}
      {showCredits && (
        <BuyCreditsModal
          token={token}
          onClose={() => setShowCredits(false)}
          onSuccess={() => { refreshUser(); setShowCredits(false); }}
        />
      )}

      {/* ── Mobile money modal (Flutterwave) ── */}
      {showMobileMoney && (
        <MobileMoneyModal
          token={token}
          onClose={() => setShowMobileMoney(false)}
          onSuccess={() => { refreshUser(); setShowMobileMoney(false); }}
        />
      )}

      {/* ── Toasts ── */}
      <Toast msg={txSuccess} type="success" onClose={() => setTxSuccess(null)} />
      <Toast msg={txError}   type="error"   onClose={() => setTxError(null)}   />
    </div>
  );
}
