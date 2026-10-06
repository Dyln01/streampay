# StreamPay — Demo Script (60 seconds)

## Scene 1: Problem (0:00–0:10)
"Subscriptions in crypto charge monthly upfront. You pay for a service you don't use. Every transaction costs gas. Mainstream users never adopt this."

## Scene 2: Solution (0:10–0:25)
"StreamPay charges per-second. You pay $0.01/hour, not $30/month. Payments accrue in real time on Monad. The payer never sees a wallet prompt — gas is abstracted via ERC-4337."

## Scene 3: Live Demo (0:25–0:45)
[Show frontend]
1. Connect MetaMask → Monad testnet
2. Create stream: merchant = 0x..., rate = 0.001 MON/sec
3. Watch accrued balance tick upward in real time
4. Merchant clicks "Claim" → transaction confirmed in <1 second
5. Show the stream dashboard: active streams, accrued amounts

## Scene 4: Why It Wins (0:45–1:00)
"Monad's 10K TPS and near-zero gas make per-second payments viable. The MPP protocol handles push/pull natively. This is how crypto payments should feel — like Web2, backed by Web3."

## Backup Recording
If testnet fails live: play pre-recorded demo video showing:
- Contract deployment on Monad testnet
- Stream creation and accrual
- Merchant claiming payment
- Gasless payer experience
