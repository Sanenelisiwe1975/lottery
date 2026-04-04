"use strict";
const crypto = require("crypto");
const { ethers } = require("ethers");

const ALGORITHM = "aes-256-gcm";
const KEY_LEN   = 32;

/**
 * Derive a 32-byte key from KEY_ENCRYPTION_SECRET using SHA-256.
 * This keeps the env var human-readable while always producing the right length.
 */
function _masterKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("KEY_ENCRYPTION_SECRET is not set in .env");
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext string (e.g. a private key) with AES-256-GCM.
 * Returns a hex string: iv(24) + authTag(32) + ciphertext
 */
function encrypt(plaintext) {
  const key = _masterKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypt a string produced by encrypt().
 */
function decrypt(stored) {
  const [ivHex, authTagHex, encHex] = stored.split(":");
  const key     = _masterKey();
  const iv      = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const enc     = Buffer.from(encHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(enc, undefined, "utf8") + decipher.final("utf8");
}

/**
 * Create a new random wallet and return its address + encrypted private key.
 * Nothing is persisted here — caller stores the result in the DB.
 */
function createCustodialWallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    address:      wallet.address,
    encryptedKey: encrypt(wallet.privateKey),
  };
}

/**
 * Reconstruct an ethers.Wallet from an encrypted key stored in the DB.
 * Optionally connect it to a provider for sending transactions.
 */
function loadWallet(encryptedKey, provider = null) {
  const privateKey = decrypt(encryptedKey);
  const wallet     = new ethers.Wallet(privateKey);
  return provider ? wallet.connect(provider) : wallet;
}

module.exports = { createCustodialWallet, loadWallet, encrypt, decrypt };
