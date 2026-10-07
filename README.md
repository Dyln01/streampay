# StreamPay — Per-Second Subscriptions on Monad

**Monad Metropolis Hackathon 2026** — Track 2: Consumer Products & Payments

StreamPay is a subscription payment dApp where users pay per-second (e.g. 0.001 MON/sec) and merchants claim accrued payments. Payments accrue in real time. The payer approves tokens once, then the contract handles everything.

## Quick Start

```bash
# 1. Get testnet MON from https://faucet.zalalena.com/monad
# 2. Deploy the contract
cd streampay
PRIVATE_KEY=0xYOUR_KEY npx hardhat run scripts/deploy-viem.ts --network monadTestnet

# 3. Start the frontend
cd frontend
NEXT_PUBLIC_STREAMPAY_ADDRESS=0x857977e328484d2e9eadf4a9446ee488a11dcc6b npm run dev
```

## Project Structure

```
streampay/
├── contracts/StreamPay.sol      # Core payment stream contract (Pausable, duration)
├── scripts/deploy-viem.ts       # Deploy script (viem)
├── scripts/test-streampay.ts    # Test suite (10/10 passing)
├── hardhat.config.ts            # Hardhat config for Monad testnet
├── frontend/
│   ├── src/app/page.tsx         # Main UI: create streams, claim, cancel, accrued
│   └── package.json
└── README.md
```

## How It Works

1. **Payer** creates a stream: merchant address + rate (MON/sec) + optional duration
2. **Payer** approves ERC-20 tokens to the contract (auto-checked in UI)
3. **Payments accrue** per-second in real time
4. **Merchant** claims accrued payments at any time
5. **Payer** can cancel anytime — remaining balance stays with merchant
6. **Owner** can pause/unpause all streams (emergency stop)

## Tech Stack

- **Contract**: Solidity 0.8.28, OpenZeppelin (SafeERC20, Ownable, Pausable)
- **Frontend**: Next.js 16, viem, Monad testnet
- **Payments**: ERC-20 per-second accrual with merchant claims
