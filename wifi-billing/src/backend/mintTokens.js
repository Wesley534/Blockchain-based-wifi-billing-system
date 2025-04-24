// backend/mintTokens.js
const ethers = require("ethers");
const fs = require("fs");
const path = require("path");

// Configuration
const CONTRACT_ADDRESS = "0x83d14bB2192e6040841b148f96A3B85ded6A2C94"; // Your contract address
const GANACHE_RPC_URL = "http://127.0.0.1:7545";
const ISP_PRIVATE_KEY = "01af554b3f973a792653269027b5fe13e71ce44e4ed2729f4208cbb92b711de6"; // Replace with ISP’s private key from Ganache
const ETH_PER_KES = 190000; // 1 ETH ≈ 190,000 KES
const MIN_ETH_AMOUNT = ethers.parseEther("0.0001"); // Minimum ETH to process (avoid spam)

// Load ABI
const artifactPath = path.resolve(__dirname, "../utils/WiFiBilling.json");
const wiFiBillingArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const wiFiBillingABI = wiFiBillingArtifact.abi;

// Initialize provider and wallet
const provider = new ethers.JsonRpcProvider(GANACHE_RPC_URL);
const wallet = new ethers.Wallet(ISP_PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, wallet);

// Monitor ISP address for incoming ETH
async function monitorTransactions() {
  try {
    const ispAddress = await contract.isp();
    console.log(`Monitoring ISP address: ${ispAddress}`);

    provider.on("block", async (blockNumber) => {
      try {
        console.log(`New block: ${blockNumber}`);
        const block = await provider.getBlock(blockNumber, true);
        for (const tx of block.transactions) {
          if (ethers.getAddress(tx.to) === ethers.getAddress(ispAddress)) {
            console.log(`Incoming transaction: ${tx.hash}`);
            const receipt = await provider.getTransactionReceipt(tx.hash);
            const value = tx.value;
            const sender = tx.from;

            // Check if ETH amount is significant
            if (value >= MIN_ETH_AMOUNT) {
              // Convert ETH to KES (WiFiTokens)
              const ethAmount = ethers.formatEther(value);
              const kesAmount = Math.floor(parseFloat(ethAmount) * ETH_PER_KES);
              console.log(`Received ${ethAmount} ETH (${kesAmount} KES) from ${sender}`);

              // Mint WiFiTokens
              try {
                const mintTx = await contract.mintTokens(sender, kesAmount, {
                  gasLimit: 100000,
                });
                await mintTx.wait();
                console.log(`Minted ${kesAmount} WiFiTokens for ${sender} (tx: ${mintTx.hash})`);
              } catch (mintError) {
                console.error(`Failed to mint tokens for ${sender}: ${mintError.message}`);
              }
            } else {
              console.log(`Ignoring small transaction: ${ethers.formatEther(value)} ETH`);
            }
          }
        }
      } catch (error) {
        console.error(`Error processing block ${blockNumber}: ${error.message}`);
      }
    });
  } catch (error) {
    console.error(`Error initializing monitor: ${error.message}`);
  }
}

// Start monitoring
monitorTransactions().catch((error) => {
  console.error(`Monitor failed: ${error.message}`);
  process.exit(1);
});