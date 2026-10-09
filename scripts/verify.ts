// Integration check against the CANONICAL deployment, using the same ABI shape the
// frontend's parseAbi mirrors. Proves the deployed bytecode answers every call the UI
// makes, then leaves one live stream behind so the dashboard isn't empty on camera.
//
// Run: npx hardhat run scripts/verify.ts --network monadTestnet

import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "fs";

const RPC = "https://testnet-rpc.monad.xyz";
const ADDR = "0x5b2e72fec4db3a7b6d315cc4560590e18d31d018" as `0x${string}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const abi = JSON.parse(readFileSync("./artifacts/contracts/StreamPay.sol/StreamPay.json", "utf-8")).abi;
  const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const payer = privateKeyToAccount(process.env.TEST_PAYER_KEY as `0x${string}`);
  const dWallet = createWalletClient({ account: deployer, chain: monadTestnet, transport: http(RPC) });
  const pWallet = createWalletClient({ account: payer, chain: monadTestnet, transport: http(RPC) });

  const read = (fn: string, args: any[] = []) => pub.readContract({ address: ADDR, abi, functionName: fn, args });
  const send = async (w: any, acct: any, fn: string, args: any[], value = BigInt(0)) => {
    const est = await pub.estimateContractGas({ address: ADDR, abi, functionName: fn, args, value, account: acct.address });
    const nonce = await pub.getTransactionCount({ address: acct.address, blockTag: "pending" });
    const hash = await w.writeContract({ address: ADDR, abi, functionName: fn, args, value, nonce, gas: (est * 13n) / 10n });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${fn} reverted (${hash})`);
    return r;
  };

  console.log("=== canonical deployment check ===");
  console.log("address:", ADDR);
  const code = await pub.getCode({ address: ADDR });
  console.log("bytecode present:", !!code && code !== "0x", `(${code ? (code.length - 2) / 2 : 0} bytes)`);
  console.log("VERSION:        ", await read("VERSION"));
  console.log("owner:          ", await read("owner"));
  console.log("paused:         ", await read("paused"));
  console.log("streamCount:    ", (await read("streamCount") as bigint).toString());
  console.log("totalEscrowed:  ", formatEther(await read("totalEscrowed") as bigint), "MON");
  console.log("contract balance:", formatEther(await pub.getBalance({ address: ADDR })), "MON");

  console.log("\n=== every call the frontend makes ===");
  const payerIds = await read("getPayerStreams", [payer.address]) as bigint[];
  const merchantIds = await read("getMerchantStreams", [deployer.address]) as bigint[];
  console.log("getPayerStreams(payer)     ->", payerIds.map(String).join(",") || "(none)");
  console.log("getMerchantStreams(merch)  ->", merchantIds.map(String).join(",") || "(none)");

  const RATE = parseEther("0.001");
  const DUR = BigInt(0); // unlimited: runs until the budget is spent (the path that used to be broken)
  const BUDGET = parseEther("0.3");
  console.log(`\nopening a live stream: payer -> merchant, ${formatEther(RATE)} MON/s, unlimited, ${formatEther(BUDGET)} MON budget`);
  const r1 = await send(pWallet, payer, "createStream", [deployer.address, RATE, DUR], BUDGET);
  const created = decodeEventLog({ abi, data: r1.logs[0].data, topics: r1.logs[0].topics }) as any;
  const id = created.args.streamId as bigint;
  console.log(`created stream #${id} (gas ${r1.gasUsed.toString()})`);

  const s: any = await read("streams", [id]);
  console.log("\nstreams(id) -> payer", s[0].slice(0, 10), "| merchant", s[1].slice(0, 10));
  console.log("  amountPerSecond", formatEther(s[2]), "| deposit", formatEther(s[3]), "| withdrawn", formatEther(s[4]));
  console.log("  duration", s[6].toString(), "| active", s[7], "| cancelled", s[8]);

  await sleep(6000);
  const acc = await read("accrued", [id]) as bigint;
  const vested = await read("vestedAmount", [id]) as bigint;
  const refund = await read("calculateRefund", [id]) as bigint;
  const status = await read("getStreamStatus", [id]);
  console.log(`\nafter 6s: accrued ${formatEther(acc)} | vested ${formatEther(vested)} | refund-if-cancelled ${formatEther(refund)} | status ${status}`);
  console.log("accrual is ticking:", acc > BigInt(0));

  const before = await pub.getBalance({ address: deployer.address });
  const r2 = await send(dWallet, deployer, "claim", [id]);
  const paid = decodeEventLog({ abi, data: r2.logs[0].data, topics: r2.logs[0].topics }) as any;
  const fee = r2.gasUsed * r2.effectiveGasPrice;
  await sleep(2000);
  const after = await pub.getBalance({ address: deployer.address });
  console.log(`\nclaim: paid ${formatEther(paid.args.amount)} MON | gas ${r2.gasUsed.toString()} = ${formatEther(fee)} MON fee`);
  console.log(`merchant delta ${formatEther(after - before)} MON == claimed - gas: ${after - before === paid.args.amount - fee}`);
  console.log("accrued resets:", formatEther(await read("accrued", [id]) as bigint), "MON");

  console.log(`\nleaving stream #${id} ACTIVE with ${formatEther((await read("totalEscrowed") as bigint))} MON escrowed so the dashboard renders on camera.`);
  console.log("Done.");
}

main().catch((e) => { console.error("FATAL:", e.shortMessage || e.message || e); process.exit(1); });
