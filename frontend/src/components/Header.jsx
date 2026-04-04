"use client";
import styles from "./Header.module.css";

export default function Header({ user, onLogout, onAddCredits, onMobileMoney }) {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>🎱</span>
        <span className={styles.logoText}>LuckyChain</span>
      </div>

      <div className={styles.walletArea}>
        {user ? (
          <>
            <span className={styles.credits}>
              🎟 {user.credits ?? 0} {user.credits === 1 ? "credit" : "credits"}
            </span>
            <button className={styles.addBtn} onClick={onAddCredits}>
              + Card
            </button>
            <button className={styles.mmBtn} onClick={onMobileMoney}>
              📱 Mobile Money
            </button>
            <span className={styles.email}>{user.email}</span>
            <button className={styles.logoutBtn} onClick={onLogout}>
              Log Out
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
