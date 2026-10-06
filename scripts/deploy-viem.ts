import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "fs";

const RPC = "https://testnet-rpc.monad.xyz";

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY env var first.");
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(RPC) });

  console.log("Deployer:", account.address);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Balance:", formatEther(balance), "MON");

  if (balance === 0n) {
    console.log("No MON. Get testnet MON from: https://faucet.monad.xyz");
    console.log("Then set PRIVATE_KEY and re-run.");
    process.exit(1);
  }

  const artifact = JSON.parse(readFileSync("./artifacts/contracts/StreamPay.sol/StreamPay.json", "utf-8"));

  console.log("Deploying StreamPay...");
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [account.address],
  });

  console.log("Tx hash:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Deployed at:", receipt.contractAddress);
}

main().catch((e) => { console.error(e); process.exit(1); });
