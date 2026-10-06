# StreamPay — Per-Second Subscriptions on Monad

**Monad Metropolis Hackathon 2026** — Track 2: Consumer Products & Payments  
**+ Agora Bounty: Best Cross-Border Payments App on Monad ($10K)**

StreamPay is a subscription payment dApp where users pay per-second (e.g. $0.01/hour) and merchants claim accrued payments. The payer never sees a wallet prompt or gas fee — the app abstracts the blockchain via ERC-4337 smart accounts and Monad's MPP (Machine Payments Protocol).

## Quick Start

```bash
# 1. Get testnet MON from https://faucet.monad.xyz
# 2. Deploy the contract
cd streampay
PRIVATE_KEY=0xYOUR_KEY npx hardhat run scripts/deploy-viem.ts --network monadTestnet

# 3. Start the frontend
cd frontend
NEXT_PUBLIC_STREAMPAY_ADDRESS=0xDEPLOYED_ADDRESS npm run dev
```

## Project Structure

```
streampay/
├── contracts/StreamPay.sol      # Core payment stream contract
├── scripts/deploy-viem.ts       # Deploy script (viem)
├── hardhat.config.ts            # Hardhat config for Monad testnet
├── frontend/
│   ├── src/app/page.tsx         # Main UI: create streams, claim payments
│   └── package.json
└── README.md
```

## How It Works

1. **Payer** creates a stream: specifies merchant address + rate (MON/sec)
2. **Payer** approves ERC-20 tokens (USDC/MON) to the contract
3. **Payments accrue** per-second in real time
4. **Merchant** claims accrued payments at any time
5. **Payer** can cancel a stream anytime

## Tech Stack

- **Contract**: Solidity 0.8.28, OpenZeppelin SafeERC20
- **Frontend**: Next.js 16, viem, Monad testnet
- **Gasless**: ERC-4337 smart accounts + paymaster (Pimlico/FastLane)
- **Payments**: Monad MPP (Machine Payments Protocol)

## Challenge Tracks Hit

- ✅ **Monad Track 2**: Consumer Products & Payments — "A payments app that never mentions a blockchain"
- ✅ **Agora Bounty**: Best Cross-Border Payments App on Monad
- ✅ **Kuru Bounty**: Best Consumer Trading App

## Prize Target

- Track prize: $30K (split 3 ways = $10K)
- Grand champion: $25K
- Agora bounty: $10K
- Total potential: $45K+
