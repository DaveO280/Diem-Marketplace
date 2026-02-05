// Hardhat deployment script for DiemCreditEscrow
// Run: npx hardhat run scripts/deploy.js --network baseSepolia

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // USDC on Base Sepolia (mintable test token; FiatToken 0x036CbD... is not minter-accessible)
  const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x6ac3ab54dc5019a2e57eccb214337ff5bbd52897";
  
  console.log("Using USDC at:", USDC_ADDRESS);

  // Deploy escrow contract
  const DiemCreditEscrow = await ethers.getContractFactory("DiemCreditEscrow");
  const escrow = await DiemCreditEscrow.deploy(USDC_ADDRESS);
  
  await escrow.deployed();
  
  console.log("✅ DiemCreditEscrow deployed to:", escrow.address);
  console.log("");
  console.log("Save this address! You'll need it for the API.");
  console.log("");
  console.log("Contract owner:", await escrow.owner());
  console.log("Platform fee:", (await escrow.platformFeeBps()).toString(), "bps (1%)");
  console.log("Unused penalty:", (await escrow.unusedPenaltyBps()).toString(), "bps (5%)");
  
  // Verify on BaseScan (optional, for testnet)
  console.log("");
  console.log("To verify on BaseScan:");
  console.log(`npx hardhat verify --network baseSepolia ${escrow.address} ${USDC_ADDRESS}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
