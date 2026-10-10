# StreamPay — Per-Second Subscriptions in Native MON

**Monad Metropolis 2026** — Track 2: Consumer Products & Payments

StreamPay charges a subscription **per second** out of escrowed MON. The payer escrows a
budget when they open the stream, the balance vests to the merchant every second, the
merchant claims whenever they like, and cancelling refunds every unearned second in the
same transaction. No keeper, no cron job, no standing allowance for a merchant to drain.

- **Contract (Monad testnet):** [`0x5b2e72fec4db3a7b6d315cc4560590e18d31d018`](https://sourcify.dev/server/repo-ui/10143/0x5b2e72fec4db3a7b6d315cc4560590e18d31d018/)
- **Verified source:** readable on [Sourcify](https://sourcify.dev/server/repo-ui/10143/0x5b2e72fec4db3a7b6d315cc4560590e18d31d018/)
- **`VERSION()`:** `2.0.0-native-mon` — read it to confirm you're pointed at this build
- **Network:** Monad testnet, chainId `10143`, RPC `https://testnet-rpc.monad.xyz`

## How it works

1. **Payer** opens a stream: merchant address + rate (MON/sec) + duration, and escrows the
   budget. `duration = 0` means "run until the deposit is spent".
2. **The balance vests every second.** Nothing needs to be scheduled — `accrued()` is pure
   arithmetic over `block.timestamp`.
3. **Merchant** calls `claim()` at any time and receives everything vested so far.
4. **Payer** calls `cancel()` at any time. One transaction settles both sides: the merchant
   is paid what already vested, the payer is refunded everything that hasn't.
5. **Owner** can pause *new* subscriptions. Pause deliberately does **not** block `claim()`
   or `cancel()`, so the owner can never trap a payer's escrow or a merchant's earnings.

The escrow model is the point: every payout comes from a balance the contract actually
holds, so refunds are arithmetically exact. The invariant `address(this).balance >=
totalEscrowed` holds at all times and is checked by the test suite.

## Quick start

```bash
# 1. Fund a wallet with testnet MON: https://faucet.zalalena.com/monad
# 2. Deploy (needs PRIVATE_KEY in .env)
npx hardhat compile
npx hardhat run scripts/deploy-viem.ts --network monadTestnet

# 3. Point the frontend at it
#    frontend/.env.local: NEXT_PUBLIC_STREAMPAY_ADDRESS=0x...
cd frontend && npm install && npm run dev     # http://localhost:3000
```

Connect MetaMask to Monad testnet, open a stream and watch it vest. To see both sides of
the flow in one browser, open a stream **to your own address** (the form has a
"use my own address" button) — or connect a second account to act as the merchant.

## Tests

```bash
npx hardhat run scripts/test-streampay.ts --network monadTestnet
```

The suite deploys a fresh contract, creates a funded second payer account, and runs 48
assertions across the full lifecycle: escrow validation, per-second accrual, claiming,
cancelling, the one-shot settle guard, pause semantics, owner controls, and the escrow
ledger.

Two things it does deliberately, because both cost real debugging time:

- **Money assertions compare balance deltas against the amounts the contract emitted**
  (`StreamCancelled.refund`, `PaymentClaimed.amount`) instead of against fixed numbers, so
  they cannot pass by accident.
- **Every money assertion polls the chain.** Monad's public RPC can serve a balance
  snapshot from just before a receipt's state change.

## Gas note (read this before demoing)

Monad **testnet** prices gas at ~102 gwei, so a write costs roughly 0.01–0.02 MON. A rate of
0.001 MON/sec is therefore economically pointless (one claim costs more than a day of
streaming). Use ≥0.01 MON/sec with multi-MON deposits on camera.

Also: **always pass an explicit gas limit.** A `cancel()` sent with a floating estimate was
measured at 3,545,029 gas (0.3616 MON); the identical call with an explicit
estimate-plus-30% limit used 135,293 gas (0.0138 MON). Both the frontend and the test
harness pin the limit.

## Project layout

```
contracts/StreamPay.sol          native-MON escrow stream (Ownable, Pausable, ReentrancyGuard)
scripts/deploy-viem.ts           deploy + print VERSION/owner
scripts/test-streampay.ts        48-assertion on-chain suite
scripts/topup.ts                 move MON between the two test accounts
scripts/archive/                 throwaway debugging scripts from earlier sessions
frontend/src/app/page.tsx        Next.js 16 + viem UI (live per-second counter)
```

## What is not built yet

Stated plainly so judges don't have to hunt for it:

- **No paymaster / ERC-4337.** The payer signs and pays for their own transactions. Gasless
  sponsoring is roadmap.
- **No cross-border/FX features.** The Agora remittance angle is a roadmap story, not code.
- Testnet only, no audit.
