import { defineConfig } from "hardhat/config";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

const PRIVATE_KEY = process.env.PRIVATE_KEY;

export default defineConfig({
  plugins: [hardhatVerify],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      type: "http" as const,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY as `0x${string}`] : [],
    },
  },
});

