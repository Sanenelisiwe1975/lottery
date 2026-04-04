"use client";
import { useState } from "react";
import styles from "./MobileMoneyModal.module.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const CURRENCIES = [
  { code: "USD", label: "USD ($)",  flag: "🌍" },
  { code: "ZAR", label: "ZAR (R)",  flag: "🇿🇦" },
  { code: "KES", label: "KES (KSh)", flag: "🇰🇪" },
  { code: "GHS", label: "GHS (₵)",  flag: "🇬🇭" },
  { code: "NGN", label: "NGN (₦)",  flag: "🇳🇬" },
  { code: "UGX", label: "UGX (USh)", flag: "🇺🇬" },
];

const PRESETS = { USD: [5, 10, 20], ZAR: [50, 100, 200], KES: [500, 1000, 2000], GHS: [30, 60, 120], NGN: [2000, 5000, 10000], UGX: [10000, 20000, 50000] };

export default function MobileMoneyModal({ token, onClose, onSuccess }) {
  const [currency, setCurrency] = useState("ZAR");
  const [amount,   setAmount]   = useState(50);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const presets = PRESETS[currency] || PRESETS.USD;

  async function handlePay() {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/mobile-payments/initiate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ amount, currency }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to initiate payment");

      window.location.href = data.payment_url;
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card}>
        <button className={styles.closeBtn} onClick={onClose}>×</button>
        <h2 className={styles.title}>Pay with Mobile Money</h2>
        <p className={styles.sub}>
          Card · Mobile Money · Bank Transfer — powered by Flutterwave
        </p>

        <div className={styles.flags}>
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              className={`${styles.flagBtn} ${currency === c.code ? styles.activeFlagBtn : ""}`}
              onClick={() => { setCurrency(c.code); setAmount(PRESETS[c.code][0]); }}
            >
              <span>{c.flag}</span>
              <span>{c.code}</span>
            </button>
          ))}
        </div>

        <div className={styles.presets}>
          {presets.map((p) => (
            <button
              key={p}
              className={`${styles.preset} ${amount === p ? styles.activePreset : ""}`}
              onClick={() => setAmount(p)}
            >
              {p}
              <span className={styles.presetSub}>{p} credits</span>
            </button>
          ))}
        </div>

        <label className={styles.label}>
          Custom amount
          <input
            className={styles.input}
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </label>

        <p className={styles.rate}>
          {amount} {currency} → {amount} ticket credits
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <button className={styles.payBtn} onClick={handlePay} disabled={loading}>
          {loading
            ? "Redirecting to Flutterwave…"
            : `Pay ${amount} ${currency} via Flutterwave`}
        </button>

        <p className={styles.note}>
          You will be redirected to Flutterwave's secure payment page.<br />
          Supports M-Pesa, MTN MoMo, Airtel, card, and bank transfer.
        </p>
      </div>
    </div>
  );
}
