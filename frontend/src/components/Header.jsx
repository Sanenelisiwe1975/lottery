"use client";
import { NETWORK_NAMES } from "../constants";
import styles from "./Header.module.css";

export default function Header({ wallet, onConnect, onDisconnect }) {
  const networkName = wallet ? (NETWORK_NAMES[wallet.chainId] ?? `Chain ${wallet.chainId}`) : null;
  const shortAddr   = wallet
    ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
    : null;

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>🎱</span>
        <span className={styles.logoText}>LuckyChain</span>
      </div>

      <div className={styles.walletArea}>
        {wallet ? (
          <>
            <span className={styles.network}>{networkName}</span>
            <button className={styles.addrBtn} onClick={onDisconnect} title="Click to disconnect">
              {shortAddr}
            </button>
          </>
        ) : (
          <button className={styles.connectBtn} onClick={onConnect}>
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
