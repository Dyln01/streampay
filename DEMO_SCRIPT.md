# StreamPay — Demo Script (60–75s)

Recorded on Monad testnet. Two MetaMask accounts help: **Payer** and **Merchant**.
Everything below is testable in one take — no cuts, no mockups.

> Use **big numbers** on camera. Testnet gas is ~102 gwei, so a write costs ~0.01–0.02 MON.
> At 0.001 MON/sec a claim costs more gas than a week of streaming and the numbers look broken.
> 0.01 MON/sec with a 6 MON escrow reads clearly and still costs almost nothing in fees.

## Setup before recording
- [ ] MetaMask on Monad testnet (chainId 10143) with MON in both accounts
- [ ] `cd frontend && npm run dev`, contract address in `frontend/.env.local`
- [ ] Both accounts already connected once (avoids the MetaMask "already pending" popup on camera)
- [ ] Fresh contract (or a clean stream list) so the dashboard isn't cluttered
- [ ] Browser zoom ~110% so the numbers are legible in the video

## Scene 1 — Problem (0:00–0:08), no screen share
"Subscriptions in crypto are all-or-nothing. You prepay a month, and if you cancel on day two the merchant keeps the money. StreamPay charges you by the second instead."

## Scene 2 — Open a stream (0:08–0:25)
- Payer wallet connected
- Merchant address, rate **0.01 MON/sec**, duration **600**; the form previews the escrow as **6 MON**
- Point at the preview line as you type: `escrow = 0.01 × 600 = 6 MON`
- Click **Escrow MON & open stream**, confirm in MetaMask
- "I escrow the budget once. There's no standing allowance for anyone to drain, and no keeper scheduling charges."

## Scene 3 — Watch it vest (0:25–0:38)
- Stay on the payer dashboard
- The progress bar fills; **accruing now** climbs every second
- Point out **refund if cancelled** falling in step
- "It's vesting in real time. Everything below the line is the merchant's; everything above it is still mine and comes back if I cancel."

## Scene 4 — Merchant claims (0:38–0:52)
- Switch MetaMask to the Merchant account (or use a second browser profile)
- The merchant card shows **claimable now** ticking up
- Click **Claim**, confirm; the toast shows the tx hash, then `confirmed`
- "The merchant draws down whenever they like. No invoice, no request, no keeper — the contract already knows what's owed."

## Scene 5 — Cancel and refund (0:52–1:05)
- Back to the Payer account
- Point at **refund if cancelled** (a large number — most of the escrow)
- Click **Cancel (refund X MON)** — the button states the exact refund
- After confirmation the row reads `settled`, and the wallet balance is visibly up
- "One transaction settles both sides: the merchant gets what vested, I get every unearned second back."

## Scene 6 — The safety story (1:05–1:20)
- Owner account: **Pause new streams**
- Try to open a stream → it reverts
- Show **Claim** and **Cancel** still work while paused
- "Pause stops new subscriptions. It can't freeze a merchant's earnings or a payer's refund — the owner has no way to trap funds. The contract can only ever sweep MON above what's escrowed."

## Closing card
- Contract address + the `VERSION` string (`2.0.0-native-mon`)
- "Per-second subscriptions in native MON — escrow once, draw down as it vests, cancel and get the rest back."
- Repo URL

## If testnet misbehaves live
Monad's public RPC sometimes serves a stale balance or rejects a tx sent immediately after another receipt. If a click fails:
1. Wait 2 seconds and click again (the UI retries and pins the pending nonce)
2. Keep a fallback recording of the same flow
Do **not** record against a paused or exhausted contract — redeploy fresh first.
