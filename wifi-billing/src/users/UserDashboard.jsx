import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import wiFiBillingArtifact from "../utils/WiFiBilling.json";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Extract the ABI from the artifact
const wiFiBillingABI = wiFiBillingArtifact.abi;

// Smart contract address (from your deployment)
const CONTRACT_ADDRESS = "0x0eB663F7c4b4cF38Ee264eA736a21eF7a9FB79D8";

// Map usernames to Ganache addresses (replace with your Ganache addresses)
const USER_ADDRESS_MAPPING = {
  user1: "0xC4Deb43c6B729cA2EA7508E5f4C39f0129A93E5d", // Ganache account 0
  user2: "0x8D4d45c7b26169E51ca8cab6AfB1058a8B10889e", // Ganache account 1
  user3: "0x73455945eF835c5E4cBd4bDa6a300A8eA632F843", // Ganache account 2
  // Add more users as needed
};

const UserDashboard = () => {
  const [dataUsage, setDataUsage] = useState([]);
  const [totalUsage, setTotalUsage] = useState(0);
  const [cumulativeUsage, setCumulativeUsage] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [billingReport, setBillingReport] = useState({ total_usage_mb: 0, total_cost_kes: 0 });
  const [error, setError] = useState("");
  const [contract, setContract] = useState(null);
  const [signer, setSigner] = useState(null);
  const [userAddress, setUserAddress] = useState("");
  const [tokenBalance, setTokenBalance] = useState(0); // New state for token balance
  const navigate = useNavigate();

  // Initialize ethers.js and connect to Ganache
  useEffect(() => {
    const initBlockchain = async () => {
      try {
        // Validate the ABI
        if (!Array.isArray(wiFiBillingABI)) {
          throw new Error("Invalid ABI: ABI must be an array");
        }

        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:7545");
        const signer = await provider.getSigner(0);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

        setContract(contract);
        setSigner(signer);

        // Get the username and map it to an Ethereum address
        const username = localStorage.getItem("username") || "user1";
        const address = USER_ADDRESS_MAPPING[username];
        if (!address) {
          throw new Error(`No Ethereum address mapped for username: ${username}`);
        }
        // Validate the address
        const validatedAddress = ethers.getAddress(address);
        setUserAddress(validatedAddress);
      } catch (err) {
        setError("Failed to connect to blockchain: " + err.message);
        console.error(err);
      }
    };
    initBlockchain();
  }, []);

  // Fetch the user's token balance
  const fetchTokenBalance = async () => {
    if (!contract || !userAddress) {
      console.warn("Cannot fetch token balance: Contract or user address not set");
      return;
    }
    try {
      const balance = await contract.tokenBalances(userAddress);
      setTokenBalance(Number(balance));
    } catch (err) {
      setError("Failed to fetch token balance: " + err.message);
      console.error(err);
    }
  };

  // Fetch data usage history from the database (FastAPI backend)
  const fetchDataUsageFromDB = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch("http://127.0.0.1:8000/data-usage", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch data usage from database");
      }

      const data = await response.json();
      setDataUsage(data);

      // Calculate total usage
      const total = data.reduce((sum, entry) => sum + entry.usage_mb, 0);
      setTotalUsage(total);

      // Calculate cumulative usage for the graph
      let cumulative = 0;
      const cumulativeData = data.map((entry) => {
        cumulative += entry.usage_mb;
        return { ...entry, cumulative_mb: cumulative };
      });
      setCumulativeUsage(cumulativeData);
    } catch (err) {
      setError("Failed to fetch data usage from database: " + err.message);
      console.error(err);
    }
  };

  // Fetch data usage history from the blockchain (for consistency)
  const fetchDataUsageFromBlockchain = async () => {
    if (!contract || !userAddress) {
      console.warn("Cannot fetch data usage from blockchain: Contract or user address not set");
      return [];
    }
    try {
      const data = await contract.getDataUsage(userAddress);
      const formattedData = data.map((entry) => ({
        usage_mb: Number(entry.usageMB),
        timestamp: new Date(Number(entry.timestamp) * 1000).toISOString().replace("T", " ").substring(0, 19),
      }));
      return formattedData;
    } catch (err) {
      setError("Failed to fetch data usage from blockchain: " + err.message);
      console.error(err);
      return [];
    }
  };

  // Fetch transaction history from the blockchain
  const fetchTransactions = async () => {
    if (!contract || !userAddress) {
      console.warn("Cannot fetch transactions: Contract or user address not set");
      return;
    }
    try {
      const txs = await contract.getTransactions(userAddress);
      const formattedTxs = txs.map((tx) => ({
        id: Number(tx.id),
        amount: Number(tx.amount),
        timestamp: new Date(Number(tx.timestamp) * 1000).toISOString().replace("T", " ").substring(0, 19),
        status: tx.status,
      }));
      setTransactions(formattedTxs);
    } catch (err) {
      setError("Failed to fetch transactions: " + err.message);
      console.error(err);
    }
  };

  // Fetch billing report from the blockchain
  const fetchBillingReport = async () => {
    if (!contract || !userAddress) {
      console.warn("Cannot fetch billing report: Contract or user address not set");
      return;
    }
    try {
      const [totalUsage, totalCost] = await contract.generateBillingReport(userAddress);
      setBillingReport({
        total_usage_mb: Number(totalUsage),
        total_cost_kes: Number(totalCost),
      });
    } catch (err) {
      setError("Failed to fetch billing report: " + err.message);
      console.error(err);
    }
  };

  // Log data usage to both database and blockchain
  const handleLogDataUsage = async (usage_mb) => {
    try {
      // Log to the database
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch("http://127.0.0.1:8000/data-usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ usage_mb }),
      });
      if (!response.ok) {
        throw new Error("Failed to log data usage to database");
      }

      // Log to the blockchain if connected
      if (contract && userAddress) {
        const tx = await contract.logDataUsage(userAddress, usage_mb);
        await tx.wait();
      }

      // Refresh data
      await fetchDataUsageFromDB();
      if (contract && userAddress) {
        await fetchDataUsageFromBlockchain();
      }
    } catch (err) {
      setError("Failed to log data usage: " + err.message);
      console.error(err);
    }
  };

  // Mint tokens for the user
  const handleMintTokens = async (amount) => {
    if (!contract || !userAddress) {
      setError("Cannot mint tokens: Blockchain not connected");
      return;
    }
    try {
      const tx = await contract.mintTokens(userAddress, amount);
      await tx.wait();
      await fetchTokenBalance(); // Refresh the token balance
      alert(`Successfully minted ${amount} WiFiTokens!`);
    } catch (err) {
      setError("Failed to mint tokens: " + err.message);
      console.error(err);
    }
  };

  // Simulate a payment using the makePayment function
  const handleSimulatePayment = async () => {
    if (!contract || !userAddress) {
      setError("Cannot simulate payment: Blockchain not connected");
      return;
    }
    try {
      // Get the cost per MB
      const costPerMB = await contract.costPerMB();
      const costPerMBNumber = Number(costPerMB);
      console.log(`Cost per MB: ${costPerMBNumber}`);

      // Calculate the total cost
      const amount = totalUsage; // Amount in MB
      const totalCost = amount * costPerMBNumber;
      console.log(`Total cost for ${amount} MB: ${totalCost} WiFiTokens`);

      // Check the user's token balance
      const tokenBalance = await contract.tokenBalances(userAddress);
      const balance = Number(tokenBalance);
      console.log(`User token balance: ${balance} WiFiTokens`);

      // Check if the user has enough tokens
      if (balance < totalCost) {
        // Automatically mint tokens if balance is insufficient
        const amountToMint = totalCost - balance + 100; // Mint a bit more than needed
        await handleMintTokens(amountToMint);
      }

      // Call makePayment
      const tx = await contract.makePayment(userAddress, amount);
      await tx.wait();

      // Refresh data
      await fetchDataUsageFromDB();
      await fetchTransactions();
      await fetchBillingReport();
      await fetchTokenBalance();

      alert("Payment simulated successfully!");
    } catch (err) {
      setError("Failed to simulate payment: " + err.message);
      console.error(err);
    }
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    navigate("/");
  };

  // Fetch data on component mount and set up polling for real-time updates
  useEffect(() => {
    const fetchAllData = async () => {
      await fetchDataUsageFromDB(); // Fetch from database for simulation data
      await fetchTransactions();
      await fetchBillingReport();
      await fetchTokenBalance(); // Fetch token balance
    };
    fetchAllData();

    // Poll for real-time updates every 10 seconds
    const interval = setInterval(fetchAllData, 10000);
    return () => clearInterval(interval);
  }, [contract, userAddress]);

  // Prepare data for the line graph (including cumulative usage)
  const chartData = cumulativeUsage.map((entry) => ({
    timestamp: entry.timestamp,
    usage_mb: entry.usage_mb,
    cumulative_mb: entry.cumulative_mb,
  }));

  return (
    <div className="min-h-screen p-8 bg-gray-900">
      {/* Header with Logout Button */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">User Dashboard</h1>
        <button
          onClick={handleLogout}
          className="bg-red-500 text-white py-2 px-4 rounded-full hover:bg-red-600 transition duration-300"
        >
          Logout
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
          <p>{error}</p>
        </div>
      )}

      {/* Cards Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Billing Report Card */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col">
          <h2 className="text-2xl font-semibold text-white mb-4">Billing Report</h2>
          <div className="text-gray-300 flex-1">
            <p className="mb-2">
              Total Data Usage: <span className="font-bold text-white">{billingReport.total_usage_mb} MB</span>
            </p>
            <p>
              Total Cost: <span className="font-bold text-white">{billingReport.total_cost_kes} KES</span>
            </p>
            <p>
              Token Balance: <span className="font-bold text-white">{tokenBalance} WiFiTokens</span>
            </p>
          </div>
        </div>

        {/* Data Usage History Card */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-2">
          <h2 className="text-2xl font-semibold text-white mb-4">Data Usage History (Real-Time)</h2>
          <p className="mb-4 text-gray-300">
            Current Session Usage: <span className="font-bold text-white">{totalUsage} MB</span>
          </p>
          {/* Add a button to manually log data usage for testing */}
          <div className="mb-4">
            <button
              onClick={() => handleLogDataUsage(50)} // Simulate 50 MB usage
              className="bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
            >
              Log 50 MB Usage (Test)
            </button>
          </div>
          {/* Line Graph for Data Usage */}
          <div className="flex-1">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis dataKey="timestamp" stroke="#ccc" tick={{ fill: "#ccc", fontSize: 12 }} />
                  <YAxis stroke="#ccc" tick={{ fill: "#ccc", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#333", border: "none", color: "#fff" }}
                    labelStyle={{ color: "#fff" }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="usage_mb"
                    stroke="#8884d8"
                    strokeWidth={3} // Thicker line for better visibility
                    activeDot={{ r: 8 }}
                    name="Usage (MB)"
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulative_mb"
                    stroke="#82ca9d"
                    strokeWidth={3} // Thicker line for better visibility
                    activeDot={{ r: 8 }}
                    name="Cumulative Usage (MB)"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray-300">No data usage history available.</p>
            )}
          </div>
        </div>

        {/* Simulate Payment Card */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col">
          <h2 className="text-2xl font-semibold text-white mb-4">Simulate Payment</h2>
          <div className="text-gray-300 flex-1">
            <p className="mb-4">
              You have used {totalUsage} MB. Simulate a payment to continue accessing WiFi.
            </p>
            <button
              onClick={() => handleMintTokens(1000)} // Mint 1000 tokens for testing
              className="bg-yellow-500 text-white py-2 px-4 rounded-full hover:bg-yellow-600 transition duration-300 mb-4"
            >
              Mint 1000 WiFiTokens (Test)
            </button>
            <button
              onClick={handleSimulatePayment}
              className="bg-theme-blue text-white py-3 px-6 rounded-full hover:bg-blue-700 transition duration-300"
              disabled={totalUsage === 0}
            >
              Simulate Payment
            </button>
          </div>
        </div>

        {/* Transaction History Card */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-4">
          <h2 className="text-2xl font-semibold text-white mb-4">Transaction History</h2>
          {transactions.length > 0 ? (
            <div className="overflow-y-auto flex-1">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Transaction ID</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Amount (KES)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Timestamp</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="bg-gray-600">
                      <td className="border border-gray-600 p-3 text-white">{tx.id}</td>
                      <td className="border border-gray-600 p-3 text-white">{tx.amount}</td>
                      <td className="border border-gray-600 p-3 text-white">{tx.timestamp}</td>
                      <td className="border border-gray-600 p-3 text-white">{tx.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300 flex-1">No transaction history available.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserDashboard;