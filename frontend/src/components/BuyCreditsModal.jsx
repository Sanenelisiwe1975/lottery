"use client";
import { useState, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import styles from "./BuyCreditsModal.module.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

const PRESETS = [5, 10, 20, 50];

function CheckoutForm({ creditsToAdd, onSuccess, onCancel }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setError(null);
    setLoading(true);

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/payment/success`,
      },
    
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message);
      setLoading(false);
    } else {

      onSuccess(creditsToAdd);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.cardStep}>
      <div className={styles.intentInfo}>
        <span className={styles.intentCredits}>{creditsToAdd} ticket credits</span>
      </div>

      <div className={styles.paymentElement}>
        <PaymentElement />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.backBtn} onClick={onCancel}>
          ← Back
        </button>
        <button type="submit" className={styles.payBtn} disabled={!stripe || loading}>
          {loading ? "Processing…" : `Pay — ${creditsToAdd} credits`}
        </button>
      </div>
    </form>
  );
}

export default function BuyCreditsModal({ token, onClose, onSuccess }) {
  const [amount,       setAmount]       = useState(10);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [step,         setStep]         = useState("pick");
  const [clientSecret, setClientSecret] = useState(null);
  const [creditsToAdd, setCreditsToAdd] = useState(0);

  async function handleContinue() {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/payments/create-intent`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ amount_usd: amount }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to create payment");
      setClientSecret(data.client_secret);
      setCreditsToAdd(data.credits_to_add);
      setStep("card");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handlePaymentSuccess(credits) {
    setCreditsToAdd(credits);
    setStep("done");
    onSuccess?.();
  }

  const stripeOptions = clientSecret
    ? { clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#a855f7" } } }
    : null;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card}>
        <button className={styles.closeBtn} onClick={onClose}>×</button>
        <h2 className={styles.title}>Add Ticket Credits</h2>
        <p className={styles.sub}>$1 = 1 ticket credit. Secure payment via Stripe.</p>

        {/* Step 1: Pick amount */}
        {step === "pick" && (
          <>
            <div className={styles.presets}>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className={`${styles.preset} ${amount === p ? styles.activePreset : ""}`}
                  onClick={() => setAmount(p)}
                >
                  ${p}<br />
                  <span className={styles.presetSub}>{p} credits</span>
                </button>
              ))}
            </div>

            <label className={styles.label}>
              Or enter amount ($1–$500)
              <input
                className={styles.input}
                type="number"
                min="1"
                max="500"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button className={styles.payBtn} onClick={handleContinue} disabled={loading}>
              {loading ? "Preparing…" : `Continue — $${amount}`}
            </button>
          </>
        )}

        {/* Step 2: Stripe card form */}
        {step === "card" && stripeOptions && (
          <Elements stripe={stripePromise} options={stripeOptions}>
            <CheckoutForm
              creditsToAdd={creditsToAdd}
              onSuccess={handlePaymentSuccess}
              onCancel={() => setStep("pick")}
            />
          </Elements>
        )}

        {/* Step 3: Done */}
        {step === "done" && (
          <div className={styles.done}>
            <span className={styles.doneIcon}>✓</span>
            <p>{creditsToAdd} credits added to your account!</p>
            <button className={styles.payBtn} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
