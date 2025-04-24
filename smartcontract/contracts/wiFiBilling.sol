// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract WiFiBilling {
    address public isp; // ISP's address (contract deployer)
    uint256 public costPerMB; // Cost per MB in wei, set by ISP

    // Struct to store user data
    struct User {
        uint256 totalUsageMB; // Total data used in MB
        uint256 totalCostEth; // Total cost in wei
        uint256[] purchasedPlanIds; // List of purchased plan IDs
        bool isRegistered; // Registration status
    }

    // Struct to store transaction data
    struct Transaction {
        uint256 id; // Transaction ID
        uint256 amount; // Amount in wei
        uint256 timestamp; // Timestamp of transaction
        string status; // Status (e.g., "Success")
    }

    // Mappings
    mapping(address => User) public users; // User address to User struct
    mapping(address => Transaction[]) public userTransactions; // User address to their transactions
    mapping(address => uint256) public transactionCount; // Count of transactions per user

    // Events
    event UserRegistered(address indexed user);
    event ISPRegistered(address indexed isp);
    event PlanPurchased(address indexed user, uint256 planId, uint256 priceEth, uint256 timestamp);
    event DataUsageLogged(address indexed user, uint256 usageMB, uint256 costEth, uint256 timestamp);
    event CostPerMBUpdated(uint256 newCostPerMB);

    // Modifiers
    modifier onlyISP() {
        require(msg.sender == isp, "Only ISP can call this function");
        _;
    }

    modifier onlyRegistered(address user) {
        require(users[user].isRegistered, "User not registered");
        _;
    }

    // Constructor
    constructor() {
        isp = msg.sender;
        costPerMB = 1 wei; // Default cost per MB (adjustable via setCostPerMB)
    }

    // Register the ISP
    function registerISP() external {
        require(msg.sender == isp, "Only the ISP can register themselves");
        require(!users[isp].isRegistered, "ISP already registered");

        users[isp].isRegistered = true;
        users[isp].totalUsageMB = 0;
        users[isp].totalCostEth = 0;
        users[isp].purchasedPlanIds = new uint256[](0);

        emit ISPRegistered(isp);
    }

    // Register a user
    function registerUser(address user) external onlyISP {
        require(user != address(0), "Invalid user address");
        require(!users[user].isRegistered, "User already registered");

        users[user].isRegistered = true;
        users[user].totalUsageMB = 0;
        users[user].totalCostEth = 0;
        users[user].purchasedPlanIds = new uint256[](0);

        emit UserRegistered(user);
    }

    // Check if a user is registered
    function isUserRegistered(address user) external view returns (bool) {
        return users[user].isRegistered;
    }

    // Purchase a WiFi plan
    function purchasePlan(uint256 planId, uint256 priceEth) external payable onlyRegistered(msg.sender) {
        require(planId > 0, "Invalid plan ID");
        require(priceEth > 0, "Price must be greater than 0");
        require(msg.value >= priceEth, "Insufficient ETH sent");

        // Refund excess ETH
        if (msg.value > priceEth) {
            uint256 refund = msg.value - priceEth;
            (bool sent, ) = payable(msg.sender).call{value: refund}("");
            require(sent, "Failed to send refund");
        }

        // Transfer ETH to ISP
        (bool sent, ) = payable(isp).call{value: priceEth}("");
        require(sent, "Failed to send ETH to ISP");

        // Update user data
        users[msg.sender].purchasedPlanIds.push(planId);
        users[msg.sender].totalCostEth += priceEth;

        // Record transaction
        uint256 txId = transactionCount[msg.sender]++;
        userTransactions[msg.sender].push(
            Transaction({
                id: txId,
                amount: priceEth,
                timestamp: block.timestamp,
                status: "Success"
            })
        );

        emit PlanPurchased(msg.sender, planId, priceEth, block.timestamp);
    }

    // Log data usage by ISP
    function logDataUsageByISP(address user, uint256 usageMB) external onlyISP onlyRegistered(user) {
        require(usageMB > 0, "Usage must be greater than 0");

        uint256 costEth = usageMB * costPerMB;
        users[user].totalUsageMB += usageMB;
        users[user].totalCostEth += costEth;

        // Record transaction
        uint256 txId = transactionCount[user]++;
        userTransactions[user].push(
            Transaction({
                id: txId,
                amount: costEth,
                timestamp: block.timestamp,
                status: "Success"
            })
        );

        emit DataUsageLogged(user, usageMB, costEth, block.timestamp);
    }

    // Set cost per MB (in wei)
    function setCostPerMB(uint256 _costPerMB) external onlyISP {
        require(_costPerMB > 0, "Cost per MB must be greater than 0");
        costPerMB = _costPerMB;
        emit CostPerMBUpdated(_costPerMB);
    }

    // Generate billing report for a user
    function generateBillingReport(address user) external view onlyRegistered(user) returns (uint256, uint256) {
        return (users[user].totalUsageMB, users[user].totalCostEth);
    }

    // Get purchased plans for a user
    function getPurchasedPlans(address user) external view onlyRegistered(user) returns (uint256[] memory) {
        return users[user].purchasedPlanIds;
    }

    // Get transactions for a user
    function getTransactions(address user) external view onlyRegistered(user) returns (Transaction[] memory) {
        return userTransactions[user];
    }

    // Fallback function to prevent accidental ETH transfers
    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }
}