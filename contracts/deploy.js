// Hardhat deployment script for DiemCreditEscrow
// Run: npx hardhat run scripts/deploy.js --network baseSepolia

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account. Set PRIVATE_KEY in contracts/.env (copy from backend/.env if needed).");
  }
  console.log("Deploying contracts with account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", balance.toString());

  // USDC testnet (Base Sepolia); mainnet uses different address
  const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897";
  
  console.log("Using USDC at:", USDC_ADDRESS);

  // Deploy escrow contract
  const DiemCreditEscrow = await ethers.getContractFactory("DiemCreditEscrow");
  const escrow = await DiemCreditEscrow.deploy(USDC_ADDRESS);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  
  console.log("✅ DiemCreditEscrow deployed to:", escrowAddress);
  console.log("");
  console.log("Save this address! Set CONTRACT_ADDRESS in backend/.env and restart the API.");
  console.log("");
  try {
    console.log("Contract owner:", await escrow.owner());
    console.log("Platform fee:", (await escrow.platformFeeBps()).toString(), "bps (1%)");
    console.log("Unused penalty:", (await escrow.unusedPenaltyBps()).toString(), "bps (5%)");
  } catch (e) {
    console.log("(Optional contract read failed; deployment succeeded.)");
  }
  console.log("");
  console.log("To verify on BaseScan:");
  console.log(`npx hardhat verify --network baseSepolia ${escrowAddress} ${USDC_ADDRESS}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
