# StreamPay — Pitch Deck

## Problem
Crypto subscriptions are all-or-nothing. You prepay a month, and if you leave early the merchant keeps the money. The usual fixes are worse:

- on-chain recurring billing needs an off-chain keeper or scheduler to fire each charge
- token-allowance billing hands the merchant a standing approval that can be drained
- cancellation is a support ticket, not a transaction

You cannot pay for exactly the time you used.

## Solution
StreamPay streams a subscription per second out of escrowed MON.

1. The payer escrows a budget when opening the stream (`rate × duration`, or an open-ended budget)
2. The balance vests to the merchant every second — no keeper, no cron, no signature to collect
3. The merchant claims whatever has vested, whenever they want
4. The payer cancels at any time: the merchant is paid what already vested, and **everything unearned is refunded in the same transaction**
5. The owner can pause *new* subscriptions, but never claim() or cancel() — nobody's MON can be trapped

Because the money is escrowed in the contract, every payout is arithmetically exact and verifiable on-chain. `balance >= totalEscrowed` holds at all times (asserted by the test suite).

## Why Monad
- Sub-second blocks make "per-second, watch it tick" feel live rather than theoretical
- Cheap enough that claiming often is practical
- Native MON means a judge can test it with a faucet drip — no owner has to mint them a token first

## Honest limitations
- Gas on Monad **testnet** is priced at ~102 gwei, so a write costs roughly 0.01–0.02 MON. Rates below ~0.001 MON/sec are economically silly (one claim costs more than a day of streaming). That is testnet pricing, not mainnet.
- There is **no paymaster yet**. The payer signs their own transactions; Monad's low fees do the work. Gasless sponsoring via ERC-4337 is roadmap, not shipped.
- Testnet only. No audit.

## Challenge tracks
- Monad Track 2 — Consumer Products & Payments
- Cross-border remittance (Agora bounty) is a **roadmap** story, not a shipped feature: streaming a wage across borders needs FX/multi-currency rails that do not exist in this build.

## Prize target
- Track 2: $30K pool
- Grand champion: $25K

## Tech stack
- Solidity 0.8.28 + OpenZeppelin (Ownable, Pausable, ReentrancyGuard), native-MON escrow
- Next.js 16 + viem, MetaMask over Monad testnet (chainId 10143)
- Hardhat 3 + viem for deploy and the on-chain test suite

## Demo flow (60s)
1. Connect MetaMask to Monad testnet
2. Open a stream: 0.01 MON/sec for 600s, 6 MON escrowed
3. Watch "accruing / claimable" tick up every second
4. Switch to the merchant wallet, claim — confirmed in under a second
5. Cancel from the payer — show the refund covering every unvested second
6. Pause new streams; show that claim and cancel still work

## Team
Solo builder. Web3 developer. Also building Otolo (gasless Naira P2P) for ETH Lagos 2026.

## Roadmap
- ERC-4337 paymaster so the payer never funds gas
- Recurring top-ups / auto-renew when a deposit runs low
- USDC and other ERC-20 streams alongside native MON
- Wage streaming for cross-border payroll (the real Agora story), with an FX leg
