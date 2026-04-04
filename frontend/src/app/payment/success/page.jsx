"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import styles from "./page.module.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function SuccessContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const [status,  setStatus]  = useState("verifying"); // "verifying" | "ok" | "pending" | "error"
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    const tx_ref = searchParams.get("tx_ref");
    if (!tx_ref) { setStatus("ok"); return; } // Stripe success (no tx_ref needed)

    // Flutterwave: verify the payment and credit the user
    const token = localStorage.getItem("lottery_token");
    if (!token) { router.push("/"); return; }

    fetch(`${API}/api/mobile-payments/verify/${tx_ref}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === "successful") {
          setCredits(data.credits_added || 0);
          setStatus("ok");
        } else {
          setStatus("pending");
        }
      })
      .catch(() => setStatus("error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.wrap}>
      {status === "verifying" && (
        <>
          <div className={styles.spinner} />
          <p className={styles.msg}>Verifying your payment…</p>
        </>
      )}

      {status === "ok" && (
        <>
          <div className={styles.icon}>✓</div>
          <h1 className={styles.title}>Payment Successful!</h1>
          {credits > 0 && (
            <p className={styles.msg}>{credits} ticket credits have been added to your account.</p>
          )}
          <button className={styles.btn} onClick={() => router.push("/")}>
            Back to LuckyChain
          </button>
        </>
      )}

      {status === "pending" && (
        <>
          <div className={styles.iconWarn}>⏳</div>
          <h1 className={styles.title}>Payment Pending</h1>
          <p className={styles.msg}>
            Your payment is being processed. Credits will appear shortly.<br />
            You can safely return to the app.
          </p>
          <button className={styles.btn} onClick={() => router.push("/")}>
            Back to LuckyChain
          </button>
        </>
      )}

      {status === "error" && (
        <>
          <div className={styles.iconErr}>✕</div>
          <h1 className={styles.title}>Verification Failed</h1>
          <p className={styles.msg}>
            We could not verify your payment. If you were charged, credits will be
            added automatically via webhook — please check your balance in a few minutes.
          </p>
          <button className={styles.btn} onClick={() => router.push("/")}>
            Back to LuckyChain
          </button>
        </>
      )}
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div className={styles.wrap}><div className={styles.spinner} /></div>}>
      <SuccessContent />
    </Suspense>
  );
}
