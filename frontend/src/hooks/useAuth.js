"use client";
import { useState, useEffect, useCallback } from "react";

const API       = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const TOKEN_KEY = "lottery_token";

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export function useAuth() {
  const [token, setToken]   = useState(null);
  const [user,  setUser]    = useState(null);  
  const [loading, setLoading] = useState(true); 

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (!stored) { setLoading(false); return; }

    fetch(`${API}/api/auth/me`, { headers: authHeaders(stored) })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.user) {
          setToken(stored);
          setUser(data.user);
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => { localStorage.removeItem(TOKEN_KEY); })
      .finally(() => setLoading(false));
  }, []);

  const _saveSession = useCallback((token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    setToken(token);
    setUser(user);
  }, []);

  const register = useCallback(async (email, password) => {
    const r = await fetch(`${API}/api/auth/register`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Registration failed");
    _saveSession(data.token, data.user);
    return data.user;
  }, [_saveSession]);

  const login = useCallback(async (email, password) => {
    const r = await fetch(`${API}/api/auth/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Login failed");
    _saveSession(data.token, data.user);
    return data.user;
  }, [_saveSession]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${API}/api/auth/me`, { headers: authHeaders(token) });
      if (r.ok) {
        const data = await r.json();
        setUser(data.user);
      }
    } catch { /* ignore */ }
  }, [token]);

  return {
    token, user, loading,
    register, login, logout, refreshUser,
    isLoggedIn: !!token,
    authHeaders: () => authHeaders(token),
  };
}
