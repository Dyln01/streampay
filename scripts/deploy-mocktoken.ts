import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "fs";

const RPC = "https://testnet-rpc.monad.xyz";

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) { console.error("Set PRIVATE_KEY in .env"); process.exit(1); }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(RPC) });

  console.log("Deployer:", account.address);

  const artifact = JSON.parse(readFileSync("./artifacts/contracts/MockToken.sol/MockToken.json", "utf-8"));
  console.log("Deploying MockToken...");
  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode });
  console.log("Tx hash:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("MockToken deployed at:", receipt.contractAddress);
}

main().catch((e) => { console.error(e); process.exit(1); });
