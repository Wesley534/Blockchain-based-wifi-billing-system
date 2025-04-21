// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract WiFiBilling {
    address public isp; // ISP address
    uint256 public planCount; // Counter for WiFi plans
    uint256 public costPerMB = 1; // Cost per MB in WiFiTokens (1 WiFiToken per MB)

    // Custom token balance for users
    mapping(address => uint256) public tokenBalances;
    // Data usage records
    mapping(address => DataUsage[]) public dataUsages;
    // Transaction records
    mapping(address => Transaction[]) public transactions;
    // User registration and purchased plans
    mapping(address => User) public users;
    // WiFi plans
    mapping(uint256 => WiFiPlan) public wifiPlans;

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

    struct User {
        bool isRegistered; // Whether the user is registered
        uint256 totalUsageMb; // Total data usage in MB
        uint256 totalCostKes; // Total cost in WiFiTokens
        uint256[] purchasedPlanIds; // List of purchased plan IDs
    }

    struct WiFiPlan {
        uint256 id; // Plan ID
        string name; // Plan name
        string duration; // e.g., "hourly", "daily", "weekly", "monthly"
        uint256 priceKes; // Price in WiFiTokens
        uint256 dataMb; // Data allowance in MB
        bool active; // Whether the plan is active
    }

    // Events
    event TokensMinted(address indexed user, uint256 amount);
    event DataUsageLogged(address indexed user, uint256 usageMB, uint256 timestamp);
    event PaymentMade(address indexed user, uint256 amount, uint256 timestamp, string status);
    event PlanCreated(uint256 id, string name, string duration, uint256 priceKes, uint256 dataMb);
    event PlanPurchased(address indexed user, uint256 planId, uint256 priceKes);
    event UserRegistered(address indexed user);
    event RegistrationAttempt(address indexed user, bool success, string reason);

    constructor() {
        isp = msg.sender; // Set the deployer as the ISP
    }

    modifier onlyISP() {
        require(msg.sender == isp, "Only ISP can call this function");
        _;
    }

    // Register a user (self-registration)
    function registerUser() external {
        if (users[msg.sender].isRegistered) {
            emit RegistrationAttempt(msg.sender, false, "User already registered");
            return;
        }
        users[msg.sender] = User(true, 0, 0, new uint256[](0));
        emit UserRegistered(msg.sender);
        emit RegistrationAttempt(msg.sender, true, "User registered successfully");
    }

    // Register a user by ISP (for admin purposes)
    function registerUserByISP(address user) external onlyISP {
        if (users[user].isRegistered) {
            emit RegistrationAttempt(user, false, "User already registered");
            return;
        }
        users[user] = User(true, 0, 0, new uint256[](0));
        emit UserRegistered(user);
        emit RegistrationAttempt(user, true, "User registered by ISP");
    }

    // Check if a user is registered
    function isUserRegistered(address userAddress) external view returns (bool) {
        return users[userAddress].isRegistered;
    }

    // Mint tokens for a user (for testing or ISP allocation)
    function mintTokens(address user, uint256 amount) external onlyISP {
        // Auto-register user if not registered
        if (!users[user].isRegistered) {
            users[user] = User(true, 0, 0, new uint256[](0));
            emit UserRegistered(user);
            emit RegistrationAttempt(user, true, "Auto-registered during mintTokens");
        }
        tokenBalances[user] += amount;
        emit TokensMinted(user, amount);
    }

    // Log data usage for a user (allow users to log their own usage)
    function logDataUsage(uint256 usageMB) external {
        // Auto-register user if not registered
        if (!users[msg.sender].isRegistered) {
            users[msg.sender] = User(true, 0, 0, new uint256[](0));
            emit UserRegistered(msg.sender);
            emit RegistrationAttempt(msg.sender, true, "Auto-registered during logDataUsage");
        }
        uint256 timestamp = block.timestamp;
        dataUsages[msg.sender].push(DataUsage(usageMB, timestamp));
        users[msg.sender].totalUsageMb += usageMB;
        emit DataUsageLogged(msg.sender, usageMB, timestamp);
    }

    // ISP can log data usage for a user (for admin purposes)
    function logDataUsageByISP(address user, uint256 usageMB) external onlyISP {
        // Auto-register user if not registered
        if (!users[user].isRegistered) {
            users[user] = User(true, 0, 0, new uint256[](0));
            emit UserRegistered(user);
            emit RegistrationAttempt(user, true, "Auto-registered during logDataUsageByISP");
        }
        uint256 timestamp = block.timestamp;
        dataUsages[user].push(DataUsage(usageMB, timestamp));
        users[user].totalUsageMb += usageMB;
        emit DataUsageLogged(user, usageMB, timestamp);
    }

    // Make a payment for data usage
    function makePayment(uint256 usageMB) external returns (uint256) {
        // Auto-register user if not registered
        if (!users[msg.sender].isRegistered) {
            users[msg.sender] = User(true, 0, 0, new uint256[](0));
            emit UserRegistered(msg.sender);
            emit RegistrationAttempt(msg.sender, true, "Auto-registered during makePayment");
        }
        uint256 cost = usageMB * costPerMB;
        require(tokenBalances[msg.sender] >= cost, "Insufficient WiFiTokens");

        // Deduct tokens
        tokenBalances[msg.sender] -= cost;
        users[msg.sender].totalCostKes += cost;

        // Record the transaction
        uint256 timestamp = block.timestamp;
        uint256 transactionId = transactions[msg.sender].length + 1;
        transactions[msg.sender].push(Transaction(transactionId, cost, timestamp, "Completed"));
        emit PaymentMade(msg.sender, cost, timestamp, "Completed");

        return transactionId;
    }

    // Create a new WiFi plan
    function createWiFiPlan(string memory name, string memory duration, uint256 priceKes, uint256 dataMb) external onlyISP {
        require(bytes(name).length > 0, "Plan name cannot be empty");
        require(bytes(duration).length > 0, "Duration cannot be empty");
        require(priceKes > 0, "Price must be greater than 0");
        require(dataMb > 0, "Data allowance must be greater than 0");

        planCount++;
        wifiPlans[planCount] = WiFiPlan(planCount, name, duration, priceKes, dataMb, true);
        emit PlanCreated(planCount, name, duration, priceKes, dataMb);
    }

    // Deactivate a WiFi plan
    function deactivateWiFiPlan(uint256 planId) external onlyISP {
        require(wifiPlans[planId].id != 0, "Plan does not exist");
        wifiPlans[planId].active = false;
    }

    // Get all active WiFi plans
    function getActivePlans() external view returns (WiFiPlan[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 1; i <= planCount; i++) {
            if (wifiPlans[i].active) {
                activeCount++;
            }
        }

        WiFiPlan[] memory activePlans = new WiFiPlan[](activeCount);
        uint256 index = 0;
        for (uint256 i = 1; i <= planCount; i++) {
            if (wifiPlans[i].active) {
                activePlans[index] = wifiPlans[i];
                index++;
            }
        }
        return activePlans;
    }

    // Purchase a WiFi plan
    function purchasePlan(uint256 planId) external {
        // Auto-register user if not registered
        if (!users[msg.sender].isRegistered) {
            users[msg.sender] = User(true, 0, 0, new uint256[](0));
            emit UserRegistered(msg.sender);
            emit RegistrationAttempt(msg.sender, true, "Auto-registered during purchasePlan");
        }
        require(wifiPlans[planId].id != 0, "Plan does not exist");
        require(wifiPlans[planId].active, "Plan is not active");
        require(tokenBalances[msg.sender] >= wifiPlans[planId].priceKes, "Insufficient WiFiTokens");

        // Deduct tokens
        tokenBalances[msg.sender] -= wifiPlans[planId].priceKes;
        users[msg.sender].totalCostKes += wifiPlans[planId].priceKes;
        users[msg.sender].purchasedPlanIds.push(planId);

        // Record the transaction
        uint256 timestamp = block.timestamp;
        uint256 transactionId = transactions[msg.sender].length + 1;
        transactions[msg.sender].push(Transaction(transactionId, wifiPlans[planId].priceKes, timestamp, "Completed"));
        emit PlanPurchased(msg.sender, planId, wifiPlans[planId].priceKes);
    }

    // Get purchased plans for a user
    function getPurchasedPlans(address userAddress) external view returns (WiFiPlan[] memory) {
        require(users[userAddress].isRegistered, "User not registered");
        uint256[] memory planIds = users[userAddress].purchasedPlanIds;
        WiFiPlan[] memory purchasedPlans = new WiFiPlan[](planIds.length);
        for (uint256 i = 0; i < planIds.length; i++) {
            purchasedPlans[i] = wifiPlans[planIds[i]];
        }
        return purchasedPlans;
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
        // Allow report generation for unregistered users (return zeros)
        if (!users[user].isRegistered) {
            return (0, 0);
        }
        return (users[user].totalUsageMb, users[user].totalCostKes);
    }
}