"use client";
import styles from "./RoundHistory.module.css";

// history entries come from backend DB via GET /api/rounds/history
// Each entry: { round_id, prize_pool_eth, total_tickets, winning_nums[], carry_out_eth, winners[] }
export default function RoundHistory({ history }) {
  if (!history || history.length === 0) {
    return (
      <div className={styles.wrap}>
        <h3 className={styles.title}>Recent Rounds</h3>
        <p className={styles.empty}>No completed rounds yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>Recent Rounds</h3>
      {history.map((r) => {
        const nums    = r.winning_nums  || [];
        const winners = r.winners       || [];
        const topTier = winners.reduce((max, w) => Math.max(max, w.match_count), 0);

        return (
          <div key={r.round_id} className={styles.card}>
            {/* Header */}
            <div className={styles.cardHeader}>
              <span className={styles.roundLabel}>Round #{r.round_id}</span>
              <span className={styles.meta}>
                {r.total_tickets} ticket{r.total_tickets !== 1 ? "s" : ""} · {r.prize_pool_eth} ETH
              </span>
            </div>

            {/* Winning balls */}
            <div className={styles.balls}>
              {nums.map((n) => (
                <span key={n} className={styles.ball}>{n}</span>
              ))}
            </div>

            {/* Winners */}
            {winners.length > 0 ? (
              <div className={styles.winners}>
                {winners.slice(0, 5).map((w, i) => (
                  <div key={i} className={styles.winner}>
                    <span className={styles.winnerAddr}>
                      {w.player.slice(0, 6)}…{w.player.slice(-4)}
                    </span>
                    <span className={styles.winnerMatches}>{w.match_count} balls</span>
                    <span className={styles.winnerPrize}>{parseFloat(w.prize_eth).toFixed(4)} ETH</span>
                  </div>
                ))}
                {winners.length > 5 && (
                  <p className={styles.more}>+{winners.length - 5} more winners</p>
                )}
              </div>
            ) : (
              <p className={styles.noWinners}>No winners this round</p>
            )}

            {/* Carry over */}
            {parseFloat(r.carry_out_eth) > 0 && (
              <p className={styles.carry}>
                ↪ {parseFloat(r.carry_out_eth).toFixed(4)} ETH carried to next round
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
