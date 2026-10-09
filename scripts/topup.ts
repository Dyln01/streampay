// Move MON between the two test accounts (testnet faucet is manual-only).
// Run: TOPUP=0.8 npx hardhat run scripts/topup.ts --network monadTestnet
// Sends TOPUP MON (default 0.8) from TEST_PAYER_KEY to PRIVATE_KEY.

import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const RPC = "https://testnet-rpc.monad.xyz";

async function main() {
  const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const payer = privateKeyToAccount(process.env.TEST_PAYER_KEY as `0x${string}`);
  const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const amt = parseEther(process.env.TOPUP || "0.8");

  const show = async (label: string) =>
    console.log(
      `${label}: payer ${formatEther(await pub.getBalance({ address: payer.address }))} | deployer ${formatEther(await pub.getBalance({ address: deployer.address }))}`
    );

  await show("before");
  const wallet = createWalletClient({ account: payer, chain: monadTestnet, transport: http(RPC) });
  const nonce = await pub.getTransactionCount({ address: payer.address, blockTag: "pending" });
  const hash = await wallet.sendTransaction({ to: deployer.address, value: amt, nonce });
  console.log(`sending ${formatEther(amt)} MON to the deployer: ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log("status:", r.status, "gasUsed:", r.gasUsed.toString());
  await new Promise((res) => setTimeout(res, 2000));
  await show("after");
}

main().catch((e) => { console.error("FATAL:", e.shortMessage || e.message); process.exit(1); });
