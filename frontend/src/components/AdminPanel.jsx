"use client";
import styles from "./AdminPanel.module.css";

export default function AdminPanel({ ownerFees, onWithdrawFees, pendingTx }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.badge}>Owner Panel</div>
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Accumulated Fees</div>
          <div className={styles.value}>{ownerFees} ETH</div>
        </div>
        <button
          className={styles.btn}
          onClick={onWithdrawFees}
          disabled={parseFloat(ownerFees) === 0 || !!pendingTx}
        >
          {pendingTx === "Withdraw Owner Fees" ? "⏳ Withdrawing…" : "Withdraw Fees"}
        </button>
      </div>
      <p className={styles.note}>
        You earn 10% of every ticket sale. Fees accumulate here and can be
        withdrawn at any time.
      </p>
    </div>
  );
}
