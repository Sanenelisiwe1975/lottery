"use client";
import { useState } from "react";
import styles from "./AuthModal.module.css";

export default function AuthModal({ onLogin, onRegister }) {
  const [mode,     setMode]     = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);

  const isRegister = mode === "register";

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (isRegister && password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        await onRegister(email.trim(), password);
      } else {
        await onLogin(email.trim(), password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>🎱 LuckyChain</div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${!isRegister ? styles.activeTab : ""}`}
            onClick={() => { setMode("login"); setError(null); }}
          >
            Log In
          </button>
          <button
            className={`${styles.tab} ${isRegister ? styles.activeTab : ""}`}
            onClick={() => { setMode("register"); setError(null); }}
          >
            Create Account
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              placeholder={isRegister ? "At least 8 characters" : "Your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isRegister ? 8 : 1}
            />
          </label>

          {isRegister && (
            <label className={styles.label}>
              Confirm Password
              <input
                className={styles.input}
                type="password"
                placeholder="Repeat your password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.submit} type="submit" disabled={loading}>
            {loading
              ? "Please wait…"
              : isRegister ? "Create Account" : "Log In"}
          </button>
        </form>

        <p className={styles.note}>
          No crypto wallet required. Play with just your email.
        </p>
      </div>
    </div>
  );
}
