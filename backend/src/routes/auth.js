"use strict";
const express = require("express");
const bcrypt  = require("bcrypt");
const jwt     = require("jsonwebtoken");

const db                   = require("../db");
const { createCustodialWallet } = require("../wallet");
const { requireAuth }      = require("../middleware/auth");

const router     = express.Router();
const SALT_ROUNDS = 12;

function signToken(userId) {
  return jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || "24h" }
  );
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (db.getUserByEmail(email.toLowerCase())) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Wrap user creation + wallet creation in a transaction
    const { address, encryptedKey } = createCustodialWallet();

    const register = db.db.transaction(() => {
      const { lastInsertRowid: userId } = db.createUser(email.toLowerCase(), passwordHash);
      db.createWallet(userId, address, encryptedKey);
      db.initBalance(userId);
      return userId;
    });

    const userId = register();
    const token  = signToken(userId);

    res.status(201).json({
      token,
      user: { id: userId, email: email.toLowerCase() },
    });
  } catch (err) {
    console.error("[auth] register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const user = db.getUserByEmail(email.toLowerCase());
    if (!user) {
      // Same timing as a real check to avoid user enumeration
      await bcrypt.hash(password, SALT_ROUNDS);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user.id);
    res.json({
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error("[auth] login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// GET /api/auth/me  (protected)
router.get("/me", requireAuth, (req, res) => {
  try {
    const wallet  = db.getWallet(req.user.id);
    const credits = db.getBalance(req.user.id);

    res.json({
      user: {
        id:      req.user.id,
        email:   req.user.email,
        address: wallet?.address,   // their custodial wallet address
        credits,
      },
    });
  } catch (err) {
    console.error("[auth] me error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

module.exports = router;
