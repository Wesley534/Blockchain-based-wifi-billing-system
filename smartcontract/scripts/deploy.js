const hre = require("hardhat");

const main = async () => {
    // Get the contract factory for WiFiBilling
    const WiFiBilling = await hre.ethers.getContractFactory("WiFiBilling");

    // Deploy the contract
    const wifiBilling = await WiFiBilling.deploy();

    // Wait for the contract to be deployed
    await wifiBilling.waitForDeployment();

    // Log the deployed contract address
    console.log("WiFiBilling deployed to:", await wifiBilling.getAddress());
};

const runMain = async () => {
    try {
        await main();
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

runMain();