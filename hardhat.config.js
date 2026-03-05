require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY       = process.env.PRIVATE_KEY       || "0x" + "0".repeat(64);
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const SEPOLIA_RPC_URL   = process.env.SEPOLIA_RPC_URL   || "";
const POLYGON_RPC_URL   = process.env.POLYGON_RPC_URL   || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },

  networks: {
    hardhat: {
      // Local network – used for `npx hardhat test`
    },

    sepolia: {
      url:      SEPOLIA_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId:  11155111,
    },

    polygon: {
      url:      POLYGON_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId:  137,
    },
  },

  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },

  gasReporter: {
    enabled:  process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY || "",
  },
};
