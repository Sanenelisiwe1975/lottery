"use strict";
const express = require("express");
const Stripe  = require("stripe");

const db           = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set in .env");
  }
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

const CREDITS_PER_DOLLAR = parseFloat(process.env.CREDITS_PER_DOLLAR || "1");

router.post("/create-intent", requireAuth, async (req, res) => {
  try {
    const { amount_usd } = req.body; // e.g. 5 for $5.00

    if (!amount_usd || amount_usd < 1) {
      return res.status(400).json({ error: "Minimum purchase is $1" });
    }
    if (amount_usd > 500) {
      return res.status(400).json({ error: "Maximum purchase is $500" });
    }

    const stripe        = getStripe();
    const amountCents   = Math.round(amount_usd * 100);
    const creditsToAdd  = amount_usd * CREDITS_PER_DOLLAR;

    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: "usd",
      metadata: {
        user_id: String(req.user.id),
        credits: String(creditsToAdd),
      },
    });

    res.json({
      client_secret:  intent.client_secret,
      credits_to_add: creditsToAdd,
    });
  } catch (err) {
    console.error("[payments] create-intent error:", err);
    res.status(500).json({ error: "Failed to create payment intent" });
  }
});

router.post("/webhook", (req, res) => {
  const sig    = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("[payments] STRIPE_WEBHOOK_SECRET not set");
    return res.status(500).end();
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("[payments] Webhook signature invalid:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  if (event.type === "payment_intent.succeeded") {
    const intent  = event.data.object;
    const userId  = parseInt(intent.metadata.user_id, 10);
    const credits = parseFloat(intent.metadata.credits);

    if (db.paymentExists(intent.id)) {
      return res.json({ received: true });
    }

    try {
      db.db.transaction(() => {
        db.insertPayment({
          userId,
          stripePaymentId: intent.id,
          amountUsd:       intent.amount / 100,
          creditsAdded:    credits,
        });
        db.addCredits(userId, credits);
      })();

      console.log(`[payments] Credited ${credits} tickets to user ${userId}`);
    } catch (err) {
      console.error("[payments] Failed to credit user:", err);
      return res.status(500).end();
    }
  }

  res.json({ received: true });
});

router.get("/history", requireAuth, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || "20", 10), 100);
  const offset = parseInt(req.query.offset || "0", 10);
  const rows   = db.getPaymentsByUser(req.user.id, limit, offset);
  res.json(rows);
});

module.exports = router;
