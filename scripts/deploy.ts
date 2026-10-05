import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "MON");

  const StreamPay = await hre.ethers.getContractFactory("StreamPay");
  const streamPay = await StreamPay.deploy(deployer.address);
  await streamPay.waitForDeployment();

  const addr = await streamPay.getAddress();
  console.log("StreamPay deployed to:", addr);
}

main().catch((e) => { console.error(e); process.exit(1); });
