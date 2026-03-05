"use client";
import styles from "./RoundCard.module.css";

// secsLeft is driven by real-time WebSocket ticks from the backend keeper.
export default function RoundCard({ round, secsLeft }) {
  if (!round) return (
    <div className={styles.card}>
      <p className={styles.loading}>Connecting to lottery…</p>
    </div>
  );

  const m = Math.floor((secsLeft || 0) / 60);
  const s = (secsLeft || 0) % 60;
  const isVrfPending  = round.drawRequested && !round.drawCompleted;
  const isProcessing  = round.drawCompleted  && !round.winningNumbers;

  return (
    <div className={styles.card}>
      <div className={styles.roundBadge}>Round #{round.roundId}</div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Prize Pool</span>
          <span className={styles.statValue}>{round.prizePool} ETH</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Tickets Sold</span>
          <span className={styles.statValue}>{round.totalTickets}</span>
        </div>
      </div>

      {/* Live countdown */}
      {!round.drawRequested && secsLeft > 0 && (
        <div className={styles.countdown}>
          <div className={styles.timeBlock}>
            <span className={styles.timeNum}>{String(m).padStart(2, "0")}</span>
            <span className={styles.timeLabel}>min</span>
          </div>
          <span className={styles.colon}>:</span>
          <div className={styles.timeBlock}>
            <span className={styles.timeNum}>{String(s).padStart(2, "0")}</span>
            <span className={styles.timeLabel}>sec</span>
          </div>
        </div>
      )}

      {/* Awaiting Chainlink VRF */}
      {isVrfPending && (
        <div className={styles.awaitingVrf}>
          <div className={styles.spinner} />
          <p>Awaiting Chainlink VRF randomness…</p>
        </div>
      )}

      {/* Counting / distributing */}
      {isProcessing && (
        <div className={styles.awaitingVrf}>
          <div className={styles.spinner} />
          <p>Counting winners &amp; distributing prizes…</p>
        </div>
      )}

      {/* Winning numbers for this round */}
      {round.winningNumbers && (
        <div className={styles.winningWrap}>
          <span className={styles.winningLabel}>Winning numbers</span>
          <div className={styles.winningBalls}>
            {round.winningNumbers.map((n) => (
              <span key={n} className={styles.winBall}>{n}</span>
            ))}
          </div>
        </div>
      )}

      <p className={styles.keeperNote}>
        🤖 Draws &amp; prize distribution run automatically every 5 minutes
      </p>
    </div>
  );
}
