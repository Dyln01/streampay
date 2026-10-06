# StreamPay — Hackathon Submission Checklist

## Pre-Submission
- [ ] Get testnet MON from https://faucet.monad.xyz
- [ ] Deploy StreamPay contract: `PRIVATE_KEY=0x... npx hardhat run scripts/deploy-viem.ts --network monadTestnet`
- [ ] Update `NEXT_PUBLIC_STREAMPAY_ADDRESS` in frontend `.env.local`
- [ ] Test full flow: create stream → accrue → claim → cancel
- [ ] Record demo video (60s, show live deployment + UI)

## Submission Package
- [ ] GitHub repo: https://github.com/Dyln01/streampay
- [ ] Deployed contract address (testnet)
- [ ] Demo video (YouTube or Loom)
- [ ] Pitch deck (PITCH_DECK.md)
- [ ] README with setup instructions

## Monad Metropolis Deadline
- **Submission deadline**: Oct 13, 2026
- **Judging**: Oct 14–27
- **Winners announced**: Nov 3

## Tracks Targeted
- Monad Track 2: Consumer Products & Payments ($30K)
- Agora Bounty: Best Cross-Border Payments App ($10K)
- Kuru Bounty: Best Consumer Trading App ($5K–$10K)
