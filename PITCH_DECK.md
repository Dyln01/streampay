# StreamPay — Pitch Deck

## Problem
Subscription payments in crypto are broken. Users pay monthly upfront, get charged even when they don't use the service, and every transaction requires gas — a terrible UX for mainstream adoption.

## Solution
StreamPay: per-second subscription payments on Monad. Users pay only for what they use. Payments accrue in real time. Merchants claim whenever they want. The payer never sees a wallet prompt or gas fee.

## How It Works
1. Payer creates a stream: merchant address + rate (e.g. $0.01/hour)
2. Payer approves tokens once — the contract handles the rest
3. Payments accrue per-second, continuously
4. Merchant claims accrued balance at any time
5. Payer can cancel anytime — remaining balance stays with merchant

## Why Monad
- 10,000 TPS, near-zero gas fees, 400ms block times
- Native ERC-4337 support — gasless transactions out of the box
- Machine Payments Protocol (MPP) built in — push/pull payments via ERC-3009

## Challenge Tracks
- ✅ Monad Track 2: Consumer Products & Payments
- ✅ Agora Bounty: Best Cross-Border Payments App ($10K)
- ✅ Kuru Bounty: Best Consumer Trading App

## Prize Target
- Track prize: $10K (3-way split)
- Grand champion: $25K
- Agora bounty: $10K
- **Total: $45K+**

## Tech Stack
- Solidity 0.8.28 + OpenZeppelin
- Next.js 16 + viem
- ERC-4337 smart accounts (Pimlico/FastLane paymaster)
- Monad MPP for gasless payments

## Demo Flow
1. Connect MetaMask to Monad testnet
2. Create a stream: 0.001 MON/sec to merchant
3. Watch accrued balance grow in real time
4. Merchant claims payment — transaction confirmed in <1s
5. Show gasless experience: payer never signs a gas tx

## Team
Solo builder. Web3/crypto developer. Building Otolo (gasless Naira P2P) and StreamPay in parallel for ETH Lagos 2026.

## Roadmap
- Post-hackathon: integrate with mobile wallets (WalletConnect)
- Add recurring stream schedules (weekly, monthly)
- Support multiple tokens (USDC, USDT)
- Launch on mainnet with live payments
