/**
 * Deployment script for DecentralizedLottery
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network sepolia
 *   npx hardhat run scripts/deploy.js --network polygon
 *
 * Before running:
 *   1. Copy .env.example → .env and fill in all values.
 *   2. Create a Chainlink VRF v2 subscription at https://vrf.chain.link
 *   3. Fund the subscription with LINK.
 *   4. After deploying, add the contract address as a "Consumer" on the
 *      VRF dashboard so it is authorised to request randomness.
 */

const { ethers, network } = require("hardhat");
require("dotenv").config();

//Chainlink VRF parameters per network
const VRF_CONFIG = {
  sepolia: {
    coordinator: "0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B",
    keyHash:     "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae",
  },
  polygon: {
    coordinator: "0xAE975071Be8F8eE67addBC1A82488F1C24858067",
    keyHash:     "0x6e099d640cde6de9d40ac749b4b594126b0169747122711109c9985d47751f93",
  },
  // For local hardhat testing we deploy a mock coordinator (see test/).
  hardhat: {
    coordinator: null,
    keyHash:     "0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c",
  },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  console.log(`\nDeploying DecentralizedLottery on: ${networkName}`);
  console.log(`Deployer address : ${deployer.address}`);
  console.log(`Deployer balance : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  const config = VRF_CONFIG[networkName];
  if (!config) {
    throw new Error(`No VRF config for network "${networkName}". Add it to the VRF_CONFIG map.`);
  }

  const subscriptionId = process.env.VRF_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    throw new Error("VRF_SUBSCRIPTION_ID not set in .env");
  }

  const coordinator  = config.coordinator;
  const keyHash      = config.keyHash;
  const subId        = BigInt(subscriptionId);

  console.log("VRF Coordinator :", coordinator);
  console.log("Key hash        :", keyHash);
  console.log("Subscription ID :", subId.toString());

  const LotteryFactory = await ethers.getContractFactory("DecentralizedLottery");
  const lottery = await LotteryFactory.deploy(coordinator, subId, keyHash);

  await lottery.waitForDeployment();

  const address = await lottery.getAddress();
  console.log(`\nDecentralizedLottery deployed at: ${address}`);

  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  NEXT STEPS                                                     │
│                                                                 │
│  1. Go to https://vrf.chain.link                               │
│  2. Open your subscription (ID ${subId})
│  3. Click "Add consumer" and paste:                            │
│       ${address}
│  4. Make sure your subscription has enough LINK.               │
│                                                                 │
│  To verify on Etherscan/Polygonscan:                           │
│    npx hardhat verify --network ${networkName} ${address} \\
│      ${coordinator} ${subId} ${keyHash}
└─────────────────────────────────────────────────────────────────┘
`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
