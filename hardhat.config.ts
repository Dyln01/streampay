import "@nomicfoundation/hardhat-ethers";
import { HardhatUserConfig } from "hardhat/config";

const DEPLOYER_PRIVATE_KEY = process.env.PRIVATE_KEY || "0xe60993dc94ec0bb9aa49b2aafb3ff801cf924c686af02dccbdef8793c1025115";

const config: HardhatUserConfig = {
  plugins: ["@nomicfoundation/hardhat-ethers"],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz",
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 10143,
      type: "http" as const,
    },
  },
};

export default config;
