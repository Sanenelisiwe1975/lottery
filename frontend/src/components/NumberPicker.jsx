"use client";
import { useState } from "react";
import styles from "./NumberPicker.module.css";

const REQUIRED = 7;
const MAX = 49;

export default function NumberPicker({ onBuy, pendingTx, disabled }) {
  const [selected, setSelected] = useState(new Set());

  const toggle = (n) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) {
        next.delete(n);
      } else if (next.size < REQUIRED) {
        next.add(n);
      }
      return next;
    });
  };

  const clear = () => setSelected(new Set());

  const handleBuy = () => {
    const sorted = [...selected].sort((a, b) => a - b);
    onBuy(sorted);
    setSelected(new Set());
  };

  const ready = selected.size === REQUIRED;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3 className={styles.title}>Pick Your 7 Lucky Numbers</h3>
        <span className={styles.counter}>
          {selected.size} / {REQUIRED} selected
        </span>
      </div>

      <div className={styles.grid}>
        {Array.from({ length: MAX }, (_, i) => i + 1).map((n) => {
          const isSelected = selected.has(n);
          const isFull     = selected.size === REQUIRED && !isSelected;
          return (
            <button
              key={n}
              className={`${styles.ball} ${isSelected ? styles.active : ""} ${isFull ? styles.dimmed : ""}`}
              onClick={() => toggle(n)}
              disabled={disabled || isFull}
              aria-pressed={isSelected}
            >
              {n}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className={styles.selection}>
          <span className={styles.selLabel}>Your numbers:</span>
          <div className={styles.selBalls}>
            {[...selected].sort((a, b) => a - b).map((n) => (
              <span key={n} className={styles.selBall}>{n}</span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.clearBtn} onClick={clear} disabled={selected.size === 0 || disabled}>
          Clear
        </button>
        <button
          className={styles.buyBtn}
          onClick={handleBuy}
          disabled={!ready || !!pendingTx || disabled}
        >
          {pendingTx === "Buy Ticket" ? "⏳ Buying…" : "🎟 Buy Ticket — 0.01 ETH"}
        </button>
      </div>
    </div>
  );
}
