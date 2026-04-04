# LotteryDApp

A provably fair 7-ball lottery dApp built with Solidity + Chainlink VRF, wrapped in a hybrid Web2/Web3 backend so users never need MetaMask, ETH, or any crypto knowledge.

---

## How It Works

1. Users register with email + password — the backend silently creates a custodial Ethereum wallet for them.
2. Users buy ticket credits with a card (Stripe) or mobile money (Flutterwave — M-Pesa, MTN, Airtel, EFT).
3. Users pick 7 numbers (1–49) and spend 1 credit to enter the current round.
4. Every 5 minutes a round ends. The backend keeper calls `triggerDraw()`, which requests verifiable randomness from Chainlink VRF.
5. Winners call claim — the backend calls `withdrawPrize()` on their behalf and converts ETH winnings back to ticket credits.

No gas fees, no seed phrases, no browser extensions — it's just a web app.

---

## Prize Table

| Matches | Prize (% of pool) |
|---------|-------------------|
| 2       | 5%                |
| 3       | 10%               |
| 4       | 15%               |
| 5       | 20%               |
| 6       | 20%               |
| 7       | 30%               |

Unused tier prizes and rounding dust roll over to the next round's pool. The owner earns 10% of every ticket sale.

---

## Tech Stack

| Layer      | Technology |
|------------|------------|
| Smart contract | Solidity 0.8.19, Chainlink VRF v2.5, OpenZeppelin ReentrancyGuard |
| Blockchain tooling | Hardhat, ethers.js v6 |
| Backend | Node.js, Express, SQLite (better-sqlite3), WebSocket (ws) |
| Payments | Stripe (cards), Flutterwave (mobile money) |
| Auth | JWT, bcrypt, AES-256-GCM custodial wallets |
| Frontend | Next.js 14, React 18, @stripe/react-stripe-js |

---

## Project Structure

```
lottery/
├── contracts/
│   └── Lottery.sol              # DecentralizedLottery smart contract
├── scripts/
│   ├── deploy.js                # Hardhat deploy script
│   └── interact.js              # CLI helper for live contract interaction
├── test/
│   └── Lottery.test.js          # Hardhat unit tests
├── backend/
│   └── src/
│       ├── server.js            # Express app + WebSocket server + keeper bot
│       ├── db.js                # SQLite schema + queries
│       ├── wallet.js            # AES-256-GCM key encryption + wallet creation
│       ├── middleware/
│       │   └── auth.js          # JWT requireAuth middleware
│       └── routes/
│           ├── auth.js          # /api/auth — register, login, me
│           ├── payments.js      # /api/payments — Stripe card payments
│           ├── mobilePayments.js# /api/mobile-payments — Flutterwave
│           ├── tickets.js       # /api/tickets — buy + list tickets
│           └── prizes.js        # /api/prizes — pending, claim, history
└── frontend/
    └── src/
        ├── app/
        │   ├── LotteryApp.jsx   # Main app shell
        │   └── payment/         # Flutterwave return pages (success / cancel)
        ├── components/
        │   ├── AuthModal.jsx
        │   ├── BuyCreditsModal.jsx
        │   ├── MobileMoneyModal.jsx
        │   ├── Header.jsx
        │   ├── NumberPicker.jsx
        │   └── ClaimPanel.jsx
        └── hooks/
            ├── useAuth.js
            └── useLottery.js
```

---

## Deployed Contract

| Network | Address |
|---------|---------|
| Ethereum Sepolia (testnet) | [`0x4fbD09661e5480A806daA8826497d1339f5d6F01`](https://sepolia.etherscan.io/address/0x4fbD09661e5480A806daA8826497d1339f5d6F01) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A funded [Chainlink VRF subscription](https://vrf.chain.link) (Sepolia)
- Alchemy (or similar) RPC endpoint
- Stripe account (test mode is fine)
- Flutterwave account (optional, for mobile money)

### 1. Smart Contract

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Run tests
npm test

# Deploy to Sepolia
npm run deploy:sep

# Verify on Etherscan
npx hardhat verify --network sepolia <DEPLOYED_ADDRESS> "<VRF_COORDINATOR>" "<SUBSCRIPTION_ID>" "<KEY_HASH>"
```

Copy `.env.example` → `.env` and fill in your values before deploying.

### 2. Backend

```bash
cd backend
cp .env.example .env   # fill in all values
npm install
npm run dev            # runs on http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # fill in all values
npm install
npm run dev                         # runs on http://localhost:3000
```

### 4. Stripe Webhook (local dev only)

```bash
stripe listen --forward-to localhost:4000/api/payments/webhook
```

Test card: `4242 4242 4242 4242` · any future expiry · any CVV

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Blockchain
RPC_URL=wss://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
KEEPER_PRIVATE_KEY=0x...
CONTRACT_ADDRESS=0x...
CHAIN_ID=11155111

# Server
PORT=4000
FRONTEND_URL=http://localhost:3000

# Auth
KEY_ENCRYPTION_SECRET=<32-byte hex>
JWT_SECRET=<32-byte hex>
JWT_EXPIRY=24h

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CREDITS_PER_DOLLAR=1
TICKET_PRICE_ETH=0.01

# Flutterwave
FLW_PUBLIC_KEY=FLWPUBK_TEST-...
FLW_SECRET_KEY=FLWSECK_TEST-...
FLW_WEBHOOK_SECRET=<any-string>
```

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

---

## API Reference

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | — | Create account + custodial wallet |
| POST | `/api/auth/login` | — | Returns JWT |
| GET | `/api/auth/me` | JWT | Profile + credit balance |
| POST | `/api/payments/create-intent` | JWT | Stripe PaymentIntent |
| POST | `/api/payments/webhook` | Stripe sig | Credits user on payment success |
| POST | `/api/mobile-payments/initiate` | JWT | Flutterwave hosted payment URL |
| POST | `/api/mobile-payments/webhook` | FLW hash | Credits user on mobile payment |
| POST | `/api/tickets/buy` | JWT | Spend 1 credit, submit tx to contract |
| GET | `/api/tickets/mine` | JWT | User's tickets for current round |
| GET | `/api/prizes/pending` | JWT | Pending ETH winnings on contract |
| POST | `/api/prizes/claim` | JWT | Claim winnings → ticket credits |

---

## Security

| Risk | Mitigation |
|------|------------|
| Private keys in DB | AES-256-GCM encrypted; decrypted in memory only |
| JWT theft | 24h expiry; HTTPS in production |
| Stripe webhook spoofing | `stripe-signature` header verified |
| Flutterwave webhook spoofing | `verif-hash` checked against secret |
| Duplicate payments | Idempotency check on all webhook handlers |
| SQL injection | Prepared statements throughout |
| Randomness manipulation | Chainlink VRF — cryptographically provable |

---

## License

MIT
