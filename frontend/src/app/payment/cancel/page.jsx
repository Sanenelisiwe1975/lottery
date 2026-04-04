"use client";
import { useRouter } from "next/navigation";
import styles from "../success/page.module.css"; // reuse same styles

export default function PaymentCancelPage() {
  const router = useRouter();
  return (
    <div className={styles.wrap}>
      <div className={styles.iconErr}>✕</div>
      <h1 className={styles.title}>Payment Cancelled</h1>
      <p className={styles.msg}>
        Your payment was cancelled and you have not been charged.
        You can try again anytime.
      </p>
      <button className={styles.btn} onClick={() => router.push("/")}>
        Back to LuckyChain
      </button>
    </div>
  );
}
