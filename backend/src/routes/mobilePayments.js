"use strict";
const express      = require("express");
const Flutterwave  = require("flutterwave-node-v3");

const db              = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const CREDITS_PER_DOLLAR = parseFloat(process.env.CREDITS_PER_DOLLAR || "1");

function getFw() {
  const pub = process.env.FLW_PUBLIC_KEY;
  const sec = process.env.FLW_SECRET_KEY;
  if (!pub || !sec) throw new Error("Flutterwave keys not configured");
  return new Flutterwave(pub, sec);
}

router.post("/initiate", requireAuth, async (req, res) => {
  try {
    const { amount, currency = "USD" } = req.body;

    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Minimum amount is 1" });
    }

    const fw      = getFw();
    const tx_ref  = `user_${req.user.id}_${Date.now()}`;
    const credits = Math.floor(amount * CREDITS_PER_DOLLAR);

    const payload = {
      tx_ref,
      amount:       String(amount),
      currency,
      redirect_url: `${process.env.FRONTEND_URL}/payment/success`,
      customer: {
        email:      req.user.email,
        name:       req.user.email.split("@")[0],
      },
      customizations: {
        title:       "LuckyChain Ticket Credits",
        description: `Buy ${credits} ticket credits`,
        logo:        "",
      },
      meta: {
        user_id: String(req.user.id),
        credits: String(credits),
      },
    };

    const response = await fw.Payment.initiate(payload);

    if (response.status !== "success") {
      return res.status(500).json({ error: response.message || "Failed to create payment link" });
    }

    res.json({
      payment_url:    response.data.link,
      credits_to_add: credits,
      tx_ref,
    });
  } catch (err) {
    console.error("[mobile-payments] initiate error:", err);
    res.status(500).json({ error: "Failed to initiate payment" });
  }
});

router.post("/webhook", express.json(), (req, res) => {
  const secretHash = process.env.FLW_WEBHOOK_SECRET;
  const signature  = req.headers["verif-hash"];

  if (!secretHash || signature !== secretHash) {
    console.warn("[mobile-payments] Webhook signature mismatch");
    return res.status(401).end();
  }

  const { event, data } = req.body;

  if (event === "charge.completed" && data?.status === "successful") {
    const userId  = parseInt(data.meta?.user_id,  10);
    const credits = parseFloat(data.meta?.credits);
    const ref     = data.tx_ref;

    if (!userId || !credits || !ref) {
      return res.status(400).end();
    }

    if (db.paymentExists(ref)) {
      return res.status(200).end();
    }

    try {
      db.db.transaction(() => {
        db.insertPayment({
          userId,
          stripePaymentId: ref,
          amountUsd:       data.charged_amount,
          creditsAdded:    credits,
        });
        db.addCredits(userId, credits);
      })();

      console.log(`[mobile-payments] Flutterwave: credited ${credits} to user ${userId}`);
    } catch (err) {
      console.error("[mobile-payments] Failed to credit user:", err);
      return res.status(500).end();
    }
  }

  res.status(200).end();
});

router.get("/verify/:tx_ref", requireAuth, async (req, res) => {
  try {
    const fw       = getFw();
    const response = await fw.Transaction.verify({ id: req.params.tx_ref });

    if (response.data?.status === "successful") {
      const credits = parseFloat(response.data.meta?.credits);
      const ref     = response.data.tx_ref;

      if (!db.paymentExists(ref)) {
        db.db.transaction(() => {
          db.insertPayment({
            userId:          req.user.id,
            stripePaymentId: ref,
            amountUsd:       response.data.charged_amount,
            creditsAdded:    credits,
          });
          db.addCredits(req.user.id, credits);
        })();
      }

      return res.json({ status: "successful", credits_added: credits });
    }

    res.json({ status: response.data?.status || "pending" });
  } catch (err) {
    console.error("[mobile-payments] verify error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

module.exports = router;
