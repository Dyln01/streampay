# StreamPay — Hackathon Submission Checklist

## Canonical deployment (the only address that matters)
- **StreamPay (native MON):** `0x5b2e72fec4db3a7b6d315cc4560590e18d31d018`
- **`VERSION()`:** `2.0.0-native-mon`
- **Owner:** `0xcb19C6D23d0753228eD86039e790A624ea4670a1`
- **Deployed:** block 69651509, Monad testnet (chainId 10143)
- Used everywhere: `frontend/.env.local`, root `.env`, this file, `README.md`.
  (Earlier drafts carried five different addresses — all superseded.)

## Status
- [x] Contract: per-second streams in native MON, escrow + refund model
- [x] Test suite: **48/48 passing on-chain** (`npx hardhat run scripts/test-streampay.ts --network monadTestnet`)
- [x] Frontend: Next.js 16 + viem, live per-second counter, claim/cancel/top-up/extend, owner panel
- [x] Escrow ledger invariant asserted (contract balance == sum of active escrow, drift 0)
- [x] `README.md` with setup, gas notes and an explicit "what is not built" section
- [x] `PITCH_DECK.md` and `DEMO_SCRIPT.md` rewritten to match what the code actually does
- [ ] **Demo video (60–75s)** — script ready in `DEMO_SCRIPT.md`, nothing recorded yet
- [x] Contract verified (Sourcify — chainId 10143 is not yet on Etherscan/Blockscout provider lists, so those two are skipped)
- [ ] (Optional) delete `scripts/archive/` throwaway scripts before judges look
- [x] `scripts/demo-setup.ts` — opens one live 24h demo stream so the dashboard is accruing on camera

## Tracks targeted
- **Monad Track 2 — Consumer Products & Payments** (primary, $30K pool)
- Agora cross-border bounty: **not claimed** — no FX/multi-currency code exists. Roadmap only.

## Claims we deliberately do NOT make
Previous drafts of the pitch promised gasless ERC-4337 paymasters, MPP push/pull, and
"the payer never sees a wallet prompt". None of that is implemented (`permissionless`,
`@monad-crypto/mpp`, `mppx`, `hono` are declared but unused). Those claims are removed;
gasless is listed as roadmap. Do not reintroduce them without building the feature.

## Deadlines
- Submission: **Oct 13, 2026**
- Judging: Oct 14–27
- Winners: Nov 3

## 60-second demo flow
1. Connect MetaMask → Monad testnet
2. Open a stream: **0.01 MON/sec, 600s, 6 MON escrowed** (big numbers — testnet gas is ~102 gwei)
3. Watch "accruing now" and the progress bar tick; "refund if cancelled" falls in step
4. Merchant account → **Claim** → confirmed in under a second
5. Payer account → **Cancel (refund X MON)** → the button names the exact refund
6. Owner → **Pause new streams** → new streams revert, claim and cancel still work
