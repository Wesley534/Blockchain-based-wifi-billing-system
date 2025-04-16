// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract WiFiBilling {
    // Custom token balance for users
    mapping(address => uint256) public tokenBalances;
    // Data usage records
    mapping(address => DataUsage[]) public dataUsages;
    // Transaction records
    mapping(address => Transaction[]) public transactions;
    // Cost per MB (in WiFiTokens)
    uint256 public costPerMB = 1; // 1 WiFiToken per MB

    struct DataUsage {
        uint256 usageMB;
        uint256 timestamp;
    }

    struct Transaction {
        uint256 id;
        uint256 amount; // Amount in WiFiTokens
        uint256 timestamp;
        string status; // "Pending", "Completed", "Failed"
    }

    event TokensMinted(address indexed user, uint256 amount);
    event DataUsageLogged(address indexed user, uint256 usageMB, uint256 timestamp);
    event PaymentMade(address indexed user, uint256 amount, uint256 timestamp, string status);

    // Mint tokens for testing (simulates a local payment system)
    function mintTokens(address user, uint256 amount) external {
        tokenBalances[user] += amount;
        emit TokensMinted(user, amount);
    }

    // Log data usage on the blockchain
    function logDataUsage(address user, uint256 usageMB) external {
        uint256 timestamp = block.timestamp;
        dataUsages[user].push(DataUsage(usageMB, timestamp));
        emit DataUsageLogged(user, usageMB, timestamp);
    }

    // Make a payment for data usage
    function makePayment(address user, uint256 usageMB) external returns (uint256) {
        uint256 cost = usageMB * costPerMB;
        require(tokenBalances[user] >= cost, "Insufficient WiFiTokens");

        // Deduct tokens
        tokenBalances[user] -= cost;

        // Record the transaction
        uint256 timestamp = block.timestamp;
        uint256 transactionId = transactions[user].length + 1;
        transactions[user].push(Transaction(transactionId, cost, timestamp, "Completed"));
        emit PaymentMade(user, cost, timestamp, "Completed");

        return transactionId;
    }

    // Get data usage history for a user
    function getDataUsage(address user) external view returns (DataUsage[] memory) {
        return dataUsages[user];
    }

    // Get transaction history for a user
    function getTransactions(address user) external view returns (Transaction[] memory) {
        return transactions[user];
    }

    // Generate a billing report for a user
    function generateBillingReport(address user) external view returns (uint256 totalUsage, uint256 totalCost) {
        DataUsage[] memory usage = dataUsages[user];
        Transaction[] memory txs = transactions[user];

        totalUsage = 0;
        for (uint256 i = 0; i < usage.length; i++) {
            totalUsage += usage[i].usageMB;
        }

        totalCost = 0;
        for (uint256 i = 0; i < txs.length; i++) {
            totalCost += txs[i].amount;
        }

        return (totalUsage, totalCost);
    }
}