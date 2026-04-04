"use client";
import styles from "./ClaimPanel.module.css";
import { PRIZE_TABLE } from "../constants";

export default function ClaimPanel({ myPrize, myTickets, onClaim, pendingTx }) {
  const hasPrize = parseFloat(myPrize) > 0;

  return (
    <div className={styles.wrap}>
      {/* Pending prize */}
      <div className={styles.prizeBox}>
        <div className={styles.prizeLabel}>Your Pending Prize</div>
        <div className={`${styles.prizeAmount} ${hasPrize ? styles.glowing : ""}`}>
          {myPrize} ETH
        </div>
        {hasPrize && (
          <>
            <p style={{ fontSize: "0.78rem", color: "#9ca3af", margin: "0.4rem 0 0", textAlign: "center" }}>
              Claiming converts your ETH prize to ticket credits.
            </p>
            <button
              className={styles.claimBtn}
              onClick={onClaim}
              disabled={!!pendingTx}
            >
              {pendingTx === "Claim Prize" ? "⏳ Claiming…" : "💰 Claim Prize → Credits"}
            </button>
          </>
        )}
      </div>

      {/* My tickets */}
      {myTickets.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>My Tickets This Round</h4>
          <div className={styles.ticketList}>
            {myTickets.map((t) => (
              <div key={t.ticketIndex} className={styles.ticket}>
                <span className={styles.ticketNum}>#{t.ticketIndex + 1}</span>
                <div className={styles.ticketBalls}>
                  {t.numbers.map((n) => (
                    <span key={n} className={styles.tball}>{n}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prize table */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Prize Table</h4>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Matches</th>
              <th>Prize</th>
            </tr>
          </thead>
          <tbody>
            {PRIZE_TABLE.map((row) => (
              <tr key={row.matches}>
                <td>{row.matches} balls</td>
                <td className={styles.pct}>{row.pct}% of pool</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.note}>
          Prizes are split equally among all winners in each tier.<br />
          Unused tiers carry over to the next round.
        </p>
      </div>
    </div>
  );
}
