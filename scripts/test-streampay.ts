// StreamPay end-to-end test suite (native MON, real two-party flow, on-chain).
// Run: npx hardhat run scripts/test-streampay.ts --network monadTestnet
//
// Deploys a fresh StreamPay, funds a second payer account, then exercises the
// full lifecycle: escrow -> accrue -> claim -> cancel -> pause -> sweeps.
//
// Two hard-won ground rules encoded here:
//  1. Monad's public RPC can serve a balance snapshot from just before a
//     receipt's state change, so every money assertion POLLS instead of
//     trusting a single read.
//  2. Monad testnet gas is not cheap (102 gwei; a cancel measured ~3.5M gas =
//     ~0.36 MON). Assertions therefore compare balance deltas against the
//     amounts the contract actually emitted, never against fixed thresholds.

import "dotenv/config";
import {
  createPublicClient, createWalletClient, http, parseEther, formatEther, decodeEventLog,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync, appendFileSync, writeFileSync } from "fs";

const RPC = "https://testnet-rpc.monad.xyz";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function ok(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL  ${msg}`);
  }
}

async function expectRevert(fn: () => Promise<any>, msg: string) {
  try {
    await fn();
    failed++;
    console.log(`  FAIL  ${msg} (expected revert, call succeeded)`);
  } catch (e: any) {
    const m = String(e.shortMessage || e.message || "").split("\n")[0].slice(0, 55);
    passed++;
    console.log(`  PASS  ${msg} [reverted: ${m}]`);
  }
}

async function main() {
  console.log("=== StreamPay Test Suite (native MON) ===\n");

  const artifact = JSON.parse(
    readFileSync("./artifacts/contracts/StreamPay.sol/StreamPay.json", "utf-8")
  );
  const abi = artifact.abi;

  const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account: deployer, chain: monadTestnet, transport: http(RPC) });

  let payerKey = process.env.TEST_PAYER_KEY as `0x${string}` | undefined;
  if (!payerKey) {
    payerKey = generatePrivateKey();
    appendFileSync(".env", `\n# test-only payer account (funded from the deployer)\nTEST_PAYER_KEY=${payerKey}\n`);
    console.log("Generated a new TEST_PAYER_KEY and wrote it to .env");
  }
  const payer = privateKeyToAccount(payerKey);

  console.log("Deployer (merchant in tests):", deployer.address);
  console.log("Payer (second party):        ", payer.address, "\n");

  const balance = (addr: string) => pub.getBalance({ address: addr as `0x${string}` });

  /// Poll until `addr`'s balance satisfies the predicate (Monad read-lag workaround).
  async function waitForBalance(addr: string, pred: (b: bigint) => boolean, tries = 20) {
    let b = await balance(addr);
    for (let i = 0; i < tries && !pred(b); i++) {
      await sleep(1000);
      b = await balance(addr);
    }
    return b;
  }

  // --- fund the payer --------------------------------------------------------
  console.log("Test 0: fund the payer account");
  // A full run costs the payer ~0.5 MON in gas alone (Monad testnet gas is real).
  const TARGET = parseEther("0.6");
  let payerBal = await balance(payer.address);
  if (payerBal < TARGET) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const nonce = await pub.getTransactionCount({ address: deployer.address, blockTag: "pending" });
        const h = await wallet.sendTransaction({ to: payer.address, value: parseEther("1"), nonce });
        const r = await pub.waitForTransactionReceipt({ hash: h });
        console.log(`  fund attempt ${attempt}: ${h} status=${r.status} nonce=${nonce}`);
        if (r.status !== "success") continue;
        payerBal = await waitForBalance(payer.address, (b) => b >= TARGET);
        if (payerBal >= TARGET) break;
      } catch (e: any) {
        console.log(`  fund attempt ${attempt}: ${String(e.shortMessage || e.message).split("\n")[0]}`);
        await sleep(2000);
      }
    }
  }
  console.log(`  deployer: ${formatEther(await balance(deployer.address))} MON`);
  console.log(`  payer:    ${formatEther(payerBal)} MON`);
  ok(payerBal >= TARGET, "payer funded");

  // --- deploy fresh contract -------------------------------------------------
  await sleep(1000);
  console.log("\nDeploying a fresh StreamPay for the run...");
  const deployHash = await wallet.deployContract({ abi, bytecode: artifact.bytecode, args: [] });
  const receipt = await pub.waitForTransactionReceipt({ hash: deployHash });
  const address = receipt.contractAddress!;
  console.log(`Contract: ${address} (deploy gas ${receipt.gasUsed.toString()})\n`);

  const read = (fn: string, args: any[] = []) =>
    pub.readContract({ address, abi, functionName: fn, args });

  const events = (rcpt: any) =>
    rcpt.logs
      .map((l: any) => {
        try {
          const d: any = decodeEventLog({ abi, data: l.data, topics: l.topics });
          return `${d.eventName}(${JSON.stringify(d.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))})`;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

  /// Pull one named argument out of a receipt's logs.
  const eventArg = (rcpt: any, name: string, arg: string) => {
    for (const l of rcpt.logs) {
      try {
        const d: any = decodeEventLog({ abi, data: l.data, topics: l.topics });
        if (d.eventName === name) return d.args[arg];
      } catch {
        /* not our event */
      }
    }
    return undefined;
  };

  const writeAs = async (acct: any, fn: string, args: any[], value = BigInt(0)) => {
    const client = createWalletClient({ account: acct, chain: monadTestnet, transport: http(RPC) });
    let lastErr: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Explicit pending nonce + 30% gas headroom: Monad's public RPC can hand
        // back a stale nonce or a tight estimate right after another receipt.
        const nonce = await pub.getTransactionCount({ address: acct.address, blockTag: "pending" });
        const est = await pub.estimateContractGas({
          address, abi, functionName: fn, args, value, account: acct.address,
        });
        const hash = await client.writeContract({
          address, abi, functionName: fn, args, value, nonce, gas: (est * 13n) / 10n,
        });
        const r = await pub.waitForTransactionReceipt({ hash });
        if (r.status !== "success") {
          let reason = `${fn} reverted on-chain (${hash})`;
          try {
            await pub.simulateContract({ address, abi, functionName: fn, args, value, account: acct.address });
          } catch (simErr: any) {
            reason += ` | re-simulating now says: ${String(simErr.shortMessage || simErr.message).split("\n")[0]}`;
          }
          throw new Error(reason);
        }
        return r;
      } catch (e: any) {
        lastErr = e;
        if (String(e.message || "").includes("reverted on-chain")) throw e; // real revert: never retry
        await sleep(1500);
      }
    }
    throw lastErr;
  };

  const struct = async (id: number) => {
    const s: any = await read("streams", [BigInt(id)]);
    return {
      payer: s[0], merchant: s[1], rate: s[2], deposit: s[3],
      withdrawn: s[4], startTime: s[5], duration: s[6], active: s[7], cancelled: s[8],
    };
  };

  // --- 1. fresh state --------------------------------------------------------
  console.log("Test 1: fresh contract state");
  ok((await read("VERSION")) === "2.0.0-native-mon", "VERSION is 2.0.0-native-mon");
  ok((await read("streamCount")) === BigInt(0), "streamCount starts at 0");
  ok((await read("totalEscrowed")) === BigInt(0), "totalEscrowed starts at 0");
  ok((await balance(address)) === BigInt(0), "contract holds no MON");

  // --- 2. escrow validation --------------------------------------------------
  console.log("\nTest 2: createStream escrow validation");
  await expectRevert(
    () => writeAs(payer, "createStream", [deployer.address, parseEther("0.001"), BigInt(10)], parseEther("0.005")),
    "escrow below rate*duration rejected"
  );
  await expectRevert(
    () => writeAs(payer, "createStream", [deployer.address, parseEther("0.001"), BigInt(10)], BigInt(0)),
    "zero escrow rejected"
  );
  await expectRevert(
    () => writeAs(payer, "createStream", [deployer.address, BigInt(0), BigInt(10)], parseEther("0.01")),
    "zero rate rejected"
  );

  // --- 3. create a 10s stream ------------------------------------------------
  console.log("\nTest 3: payer opens a 10s stream (0.001 MON/sec, 0.01 MON escrow)");
  const r3 = await writeAs(payer, "createStream", [deployer.address, parseEther("0.001"), BigInt(10)], parseEther("0.01"));
  console.log(`  createStream gas ${r3.gasUsed.toString()}`);
  console.log(`  ${events(r3).join(", ")}`);
  ok((await read("streamCount")) === BigInt(1), "streamCount is 1");
  let s = await struct(0);
  ok(s.payer.toLowerCase() === payer.address.toLowerCase(), "payer recorded");
  ok(s.merchant.toLowerCase() === deployer.address.toLowerCase(), "merchant recorded");
  ok(s.deposit === parseEther("0.01"), "deposit escrowed = 0.01 MON");
  ok(s.duration === BigInt(10), "duration = 10s");
  ok(s.active === true, "stream active");
  ok(s.cancelled === false, "stream not cancelled");
  ok((await read("totalEscrowed")) === parseEther("0.01"), "totalEscrowed = 0.01 MON");
  ok((await balance(address)) === parseEther("0.01"), "contract holds the escrow");
  ok((await read("getPayerStreams", [payer.address]) as bigint[]).length === 1, "payer index has the stream");
  ok((await read("getMerchantStreams", [deployer.address]) as bigint[]).length === 1, "merchant index has the stream");

  // --- 4. accrual ------------------------------------------------------------
  console.log("\nTest 4: per-second accrual");
  const a0 = (await read("accrued", [BigInt(0)])) as bigint;
  console.log(`  accrued immediately: ${formatEther(a0)} MON`);
  await sleep(4000);
  const a1 = (await read("accrued", [BigInt(0)])) as bigint;
  const v1 = (await read("vestedAmount", [BigInt(0)])) as bigint;
  console.log(`  after 4s: accrued ${formatEther(a1)} MON / vested ${formatEther(v1)} MON`);
  ok(a1 > BigInt(0), "accrued grows over time");
  ok(a1 <= parseEther("0.005"), "accrued capped by elapsed time");

  // --- 5. claim --------------------------------------------------------------
  console.log("\nTest 5: merchant claims");
  await expectRevert(() => writeAs(payer, "claim", [BigInt(0)]), "non-merchant cannot claim");
  const merchantBefore = await balance(deployer.address);
  const r5 = await writeAs(deployer, "claim", [BigInt(0)]);
  const paid5 = eventArg(r5, "PaymentClaimed", "amount") as bigint;
  const claimed = (await read("accrued", [BigInt(0)])) as bigint;
  const merchantAfter = await waitForBalance(deployer.address, (b) => b !== merchantBefore);
  s = await struct(0);
  console.log(`  claim gas ${r5.gasUsed.toString()} | claimed ${formatEther(paid5)} MON`);
  ok(s.withdrawn === paid5, "withdrawn == the amount the event says was paid");
  ok(claimed <= parseEther("0.001"), "accrued resets to ~0 after claim");
  ok((await read("totalEscrowed")) === parseEther("0.01") - s.withdrawn, "totalEscrowed decremented by the claim");
  const gas5 = r5.gasUsed * r5.effectiveGasPrice;
  console.log(`  merchant delta: ${formatEther(merchantAfter - merchantBefore)} MON (= claimed - gas; the merchant paid for its own claim)`);
  ok(merchantAfter - merchantBefore === paid5 - gas5, "merchant net == claimed amount - gas fee");

  // --- 6. unlimited stream (the old contract could never pay this) -----------
  console.log("\nTest 6: unlimited stream (duration 0) accrues and is claimable");
  await writeAs(payer, "createStream", [deployer.address, parseEther("0.001"), BigInt(0)], parseEther("0.01"));
  await sleep(3000);
  const a2 = (await read("accrued", [BigInt(1)])) as bigint;
  console.log(`  unlimited accrued after 3s: ${formatEther(a2)} MON`);
  ok(a2 > BigInt(0), "unlimited stream accrues (regression: used to stay 0 forever)");
  const r6 = await writeAs(deployer, "claim", [BigInt(1)]);
  const paid6 = eventArg(r6, "PaymentClaimed", "amount") as bigint;
  console.log(`  claim gas ${r6.gasUsed.toString()} | claimed ${formatEther(paid6)} MON`);
  ok(paid6 > BigInt(0), "unlimited stream claimable (regression: used to revert)");
  ok((await struct(1)).withdrawn === paid6, "unlimited stream tracks what was withdrawn");

  // --- 7. cancel settles both sides -----------------------------------------
  console.log("\nTest 7: cancel pays the merchant and refunds the payer");
  const RATE7 = parseEther("0.0001");
  const DUR7 = BigInt(500);
  await writeAs(payer, "createStream", [deployer.address, RATE7, DUR7], RATE7 * DUR7);
  const id = 2;
  await sleep(2000);
  const refundPreview = (await read("calculateRefund", [BigInt(id)])) as bigint;
  const payerBefore = await balance(payer.address);
  const mBefore = await balance(deployer.address);
  const r7 = await writeAs(payer, "cancel", [BigInt(id)]);
  const refund = eventArg(r7, "StreamCancelled", "refund") as bigint;
  const paidOut = eventArg(r7, "StreamCancelled", "paidToMerchant") as bigint;
  const gasFee = r7.gasUsed * r7.effectiveGasPrice;
  console.log(`  cancel gas ${r7.gasUsed.toString()} @ ${r7.effectiveGasPrice.toString()} wei = ${formatEther(gasFee)} MON fee`);
  console.log(`  StreamCancelled: refund ${formatEther(refund)} MON + paidToMerchant ${formatEther(paidOut)} MON`);
  const sc = await struct(id);
  const payerAfter = await waitForBalance(payer.address, (b) => b !== payerBefore);
  const mAfter = await waitForBalance(deployer.address, (b) => b !== mBefore);
  ok(sc.active === false, "stream marked inactive after cancel");
  ok(sc.cancelled === true, "stream flagged cancelled (one-shot, cannot be settled twice)");
  ok(refundPreview > parseEther("0.04"), `calculateRefund = ${formatEther(refundPreview)} MON before the cancel`);
  ok(refund <= refundPreview && refund > parseEther("0.04"), `refund ${formatEther(refund)} MON is the unvested remainder (<= the earlier preview of ${formatEther(refundPreview)}, since more time vested in between)`);
  ok(paidOut > BigInt(0), "merchant was paid the vested share in the same tx");
  console.log(`  payer delta:    ${formatEther(payerAfter - payerBefore)} MON (= refund - gas fee)`);
  console.log(`  merchant delta: ${formatEther(mAfter - mBefore)} MON`);
  ok(payerAfter - payerBefore === refund - gasFee, "payer balance moved by exactly refund - gas fee");
  ok(mAfter - mBefore === paidOut, "merchant balance gained exactly the vested share");
  ok((await read("calculateRefund", [BigInt(id)])) === BigInt(0), "refund reads 0 after settlement");

  // --- 8. settled streams are closed ---------------------------------------
  console.log("\nTest 8: settled stream rejects further claims");
  await expectRevert(() => writeAs(deployer, "claim", [BigInt(id)]), "claim on a settled stream reverts");
  await expectRevert(() => writeAs(payer, "cancel", [BigInt(id)]), "second cancel reverts (escrow cannot be paid out twice)");

  // --- 9. pause stops new streams but never traps funds ---------------------
  console.log("\nTest 9: pause blocks new streams, not claims/refunds");
  const RATE9 = parseEther("0.0001");
  const DUR9 = BigInt(500);
  await writeAs(payer, "createStream", [deployer.address, RATE9, DUR9], RATE9 * DUR9);
  const id9 = 3;
  await writeAs(deployer, "pause", []);
  ok((await read("paused")) === true, "contract reports paused");
  await expectRevert(
    () => writeAs(payer, "createStream", [deployer.address, parseEther("0.001"), BigInt(10)], parseEther("0.01")),
    "createStream reverts while paused"
  );
  await sleep(1500);
  const r9c = await writeAs(deployer, "claim", [BigInt(id9)]);
  console.log(`  claim while paused: ${events(r9c).join(", ")}`);
  ok(true, "merchant can still claim while paused (earnings never trapped)");
  // Static call: same requires, same live state, no 3.5M-gas transaction.
  await pub.simulateContract({
    address, abi, functionName: "cancel", args: [BigInt(id9)], account: payer.address,
  });
  ok(true, "payer can still cancel while paused (escrow never trapped)");
  await writeAs(deployer, "unpause", []);
  ok((await read("paused")) === false, "unpaused");

  // --- 10. solvency invariant -----------------------------------------------
  console.log("\nTest 10: solvency invariant and owner controls");
  const bal = await balance(address);
  const esc = (await read("totalEscrowed")) as bigint;
  console.log(`  contract balance: ${formatEther(bal)} MON / totalEscrowed: ${formatEther(esc)} MON`);
  ok(bal >= esc, "contract balance >= totalEscrowed (solvent)");
  await expectRevert(() => writeAs(deployer, "sweepExcess", []), "sweepExcess reverts when there is no excess");
  await expectRevert(() => writeAs(payer, "pause", []), "non-owner cannot pause");
  const ledger = await reconcile(pub, address, abi, await read("streamCount") as bigint);
  console.log(`  ledger: active escrow ${formatEther(ledger.escrow)} MON vs balance ${formatEther(ledger.balance)} MON`);
  ok(ledger.drift === BigInt(0), "contract balance == sum of active escrow (no drift, no missing MON)");

  // --- summary ---------------------------------------------------------------
  console.log("\n=== Results ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  writeFileSync(
    "./test-results.json",
    JSON.stringify(
      {
        passed, failed, total: passed + failed,
        testContract: address,
        note: "throwaway contract deployed by the suite itself - NOT the submission address (see README.md)",
        version: "2.0.0-native-mon",
      },
      null,
      2
    ) + "\n"
  );
  console.log("Results saved to test-results.json");

  if (failed > 0) process.exit(1);
}

/// Sum what the still-active streams hold and compare with the live balance.
async function reconcile(pub: any, address: `0x${string}`, abi: any, count: bigint) {
  let escrow = BigInt(0);
  for (let id = 0; id < Number(count); id++) {
    const s: any = await pub.readContract({ address, abi, functionName: "streams", args: [BigInt(id)] });
    if (s[7] === true) escrow += s[3] - s[4]; // active: deposit - withdrawn
  }
  const balance: bigint = await pub.getBalance({ address });
  return { escrow, balance, drift: balance - escrow };
}

main().catch((e) => {
  console.error("FATAL:", e.shortMessage || e.message || e);
  process.exit(1);
});
