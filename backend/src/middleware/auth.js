"use strict";
const jwt = require("jsonwebtoken");
const db  = require("../db");

/**
 * Express middleware that verifies the JWT in the Authorization header.
 * On success, attaches req.user = { id, email } and calls next().
 * On failure, responds 401.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Verify user still exists in DB (handles deleted accounts)
    const user = db.getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: "User not found" });

    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
