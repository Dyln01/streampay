// Demo rehearsal setup: opens ONE live, long-running stream from the deployer to
// the deployer (you can act as both payer and merchant from the same wallet), so the
// dashboard is already accruing when the judges open the app. Idempotent-ish: run it
// once before judging, then use the UI to claim/cancel on camera.
//
// Run: npx hardhat run scripts/demo-setup.ts --network monadTestnet

import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "fs";

const RPC = "https://testnet-rpc.monad.xyz";
const ADDR = "0x5b2e72fec4db3a7b6d315cc4560590e18d31d018" as `0x${string}`;

// Sized to look real on screen while staying fundable from the faucet. Override with
// DEMO_RATE / DEMO_DURATION_SECS env vars if your wallet is better stocked.
const RATE = parseEther(process.env.DEMO_RATE || "0.0005");      // MON/s
const DURATION = BigInt(process.env.DEMO_DURATION_SECS || "600"); // 10 minutes
const DEPOSIT = RATE * DURATION;                                  // 0.3 MON by default

async function main() {
  const abi = JSON.parse(readFileSync("./artifacts/contracts/StreamPay.sol/StreamPay.json", "utf-8")).abi;
  const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const acct = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const wallet = createWalletClient({ account: acct, chain: monadTestnet, transport: http(RPC) });

  console.log("demo wallet:", acct.address);
  const bal = await pub.getBalance({ address: acct.address });
  console.log("balance:", formatEther(bal), "MON");

  // Already have a live demo stream? Just report it instead of opening another.
  const ids = await pub.readContract({ address: ADDR, abi, functionName: "getPayerStreams", args: [acct.address] }) as bigint[];
  for (const id of ids) {
    const s: any = await pub.readContract({ address: ADDR, abi, functionName: "streams", args: [id] });
    if (s[7] && !s[8] && s[3] - s[4] > parseEther("0.5")) {
      console.log(`stream #${id} already live with ${formatEther(s[3] - s[4])} MON remaining — ready for the camera.`);
      return;
    }
  }

  if (bal < DEPOSIT + parseEther("0.05")) {
    throw new Error(
      `need ${formatEther(DEPOSIT)} MON + gas, wallet has ${formatEther(bal)}. ` +
      `Get testnet MON from https://faucet.zalalena.com/monad first.`
    );
  }

  const est = await pub.estimateContractGas({
    address: ADDR, abi, functionName: "createStream",
    args: [acct.address, RATE, DURATION], value: DEPOSIT, account: acct.address,
  });
  const nonce = await pub.getTransactionCount({ address: acct.address, blockTag: "pending" });
  const hash = await wallet.writeContract({
    address: ADDR, abi, functionName: "createStream",
    args: [acct.address, RATE, DURATION], value: DEPOSIT,
    nonce, gas: (est * 13n) / 10n,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`createStream reverted (${hash})`);

  const ev = decodeEventLog({ abi, data: r.logs[0].data, topics: r.logs[0].topics }) as any;
  console.log(`demo stream #${ev.args.streamId} live: ${formatEther(RATE)} MON/s for ${DURATION}s, ${formatEther(DEPOSIT)} MON escrowed`);
  console.log(`it accrues ${formatEther(RATE * 60n)} MON/min — open the UI and watch the counter move.`);
}

main().catch((e) => { console.error("FATAL:", e.shortMessage || e.message || e); process.exit(1); });
