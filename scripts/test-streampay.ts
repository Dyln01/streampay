// StreamPay Test Suite
// Run: npx tsx scripts/test-streampay.ts

import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseUnits, formatEther, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const RPC = "https://testnet-rpc.monad.xyz";
const DEPLOYER_KEY = process.env.PRIVATE_KEY;

if (!DEPLOYER_KEY) {
  console.error("Set PRIVATE_KEY env var");
  process.exit(1);
}

const account = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(RPC) });

const STREAMPAY_ABI = parseAbi([
  "function createStream(address _merchant, uint256 _amountPerSecond, uint256 _duration) external returns (uint256)",
  "function claim(uint256 _streamId) external returns (uint256)",
  "function cancel(uint256 _streamId) external",
  "function accrued(uint256 _streamId) external view returns (uint256)",
  "function streams(uint256) external view returns (address payer, address merchant, uint256 amountPerSecond, uint256 startTime, uint256 lastClaimed, uint256 totalPaid, uint256 duration, bool active)",
  "function getPayerStreams(address) external view returns (uint256[])",
  "function getMerchantStreams(address) external view returns (uint256[])",
  "function paymentToken() external view returns (address)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function streamCount() external view returns (uint256)",
  "function pause() external",
  "function unpause() external",
]);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function main() {
  console.log("=== StreamPay Test Suite ===\n");

  // Get contract address from env or artifact
  const artifact = JSON.parse(await(await import("fs")).promises.readFile("./artifacts/contracts/StreamPay.sol/StreamPay.json", "utf-8"));

  // Deploy fresh contract for testing
  console.log("Deploying test contract...");
  const deployHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [account.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const contractAddr = receipt.contractAddress!;
  console.log(`Contract: ${contractAddr}\n`);

  const contract = { address: contractAddr, abi: STREAMPAY_ABI };

  // Test 1: Initial state
  console.log("Test 1: Initial state");
  const initialCount = await publicClient.readContract({ ...contract, functionName: "streamCount", args: [] });
  assert(initialCount === 0n, "streamCount starts at 0");

  // Test 2: Create stream
  console.log("\nTest 2: Create stream");
  const merchant = "0x" + "ff".repeat(20);
  const createHash = await walletClient.writeContract({
    ...contract, functionName: "createStream",
    args: [merchant as `0x${string}`, parseUnits("0.001", 18), 0n],
  });
  await publicClient.waitForTransactionReceipt({ hash: createHash });
  const countAfter = await publicClient.readContract({ ...contract, functionName: "streamCount", args: [] });
  assert(countAfter === 1n, "streamCount incremented to 1");

  // Test 3: Stream data
  console.log("\nTest 3: Stream data");
  const stream = await publicClient.readContract({ ...contract, functionName: "streams", args: [0n] });
  assert(stream[1].toLowerCase() === merchant.toLowerCase(), "merchant address correct");
  assert(stream[2] === parseUnits("0.001", 18), "amountPerSecond correct");
  assert(stream[6] === BigInt(0), "duration is 0");
  assert(stream[7] === true, "stream is active");

  // Test 4: Accrued before time passes
  console.log("\nTest 4: Accrued before time passes");
  const accrued0 = await publicClient.readContract({ ...contract, functionName: "accrued", args: [0n] });
  console.log(`  Accrued: ${formatEther(accrued0)} MON (should be ~0)`);

  // Test 5: Get payer/merchant streams
  console.log("\nTest 5: Stream indexing");
  const payerStreams = await publicClient.readContract({ ...contract, functionName: "getPayerStreams", args: [account.address] });
  const merchantStreams = await publicClient.readContract({ ...contract, functionName: "getMerchantStreams", args: [merchant] });
  assert((payerStreams as bigint[]).length === 1, "payer has 1 stream");
  assert((merchantStreams as bigint[]).length === 1, "merchant has 1 stream");

  // Test 6: Cancel stream
  console.log("\nTest 6: Cancel stream");
  const cancelHash = await walletClient.writeContract({
    ...contract, functionName: "cancel", args: [0n],
  });
  await publicClient.waitForTransactionReceipt({ hash: cancelHash });
  const streamAfterCancel = await publicClient.readContract({ ...contract, functionName: "streams", args: [0n] });
  assert(streamAfterCancel[7] === false, "stream is inactive after cancel");

  // Test 7: Cannot claim cancelled stream
  console.log("\nTest 7: Cannot claim cancelled stream");
  try {
    await walletClient.writeContract({
      ...contract, functionName: "claim", args: [0n],
    });
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(true, "claim on cancelled stream reverted");
  }

  // Summary
  console.log("\n=== Results ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  const result = { passed, failed, total: passed + failed, contract: contractAddr };
  await (await import("fs")).promises.writeFile("./test-results.json", JSON.stringify(result, null, 2));
  console.log("\nResults saved to test-results.json");

  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
