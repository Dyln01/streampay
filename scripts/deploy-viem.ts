// Deploy StreamPay (native MON) to Monad testnet.
// Run: npx hardhat run scripts/deploy-viem.ts --network monadTestnet

import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "fs";

const RPC = "https://testnet-rpc.monad.xyz";

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(RPC) });

  const artifact = JSON.parse(
    readFileSync("./artifacts/contracts/StreamPay.sol/StreamPay.json", "utf-8")
  );
  const abi = artifact.abi;

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Deployer: ", account.address);
  console.log("Balance:  ", formatEther(balance), "MON");

  if (balance === BigInt(0)) {
    console.error("Deployer has no MON. Get testnet MON from https://faucet.zalalena.com/monad");
    process.exit(1);
  }

  console.log("\nDeploying StreamPay (native MON, no token argument)...");
  const hash = await walletClient.deployContract({
    abi,
    bytecode: artifact.bytecode,
    args: [],
  });
  console.log("Tx:       ", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress!;

  const [version, owner, escrowed] = await Promise.all([
    publicClient.readContract({ address, abi, functionName: "VERSION" }),
    publicClient.readContract({ address, abi, functionName: "owner" }),
    publicClient.readContract({ address, abi, functionName: "totalEscrowed" }),
  ]);

  console.log("\n=================================================");
  console.log("StreamPay deployed at:", address);
  console.log("VERSION:              ", version);
  console.log("Owner:                ", owner);
  console.log("totalEscrowed:        ", escrowed.toString());
  console.log("Block:                ", receipt.blockNumber.toString());
  console.log("=================================================");
  console.log("\nNext: put this in frontend/.env.local");
  console.log(`NEXT_PUBLIC_STREAMPAY_ADDRESS=${address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
