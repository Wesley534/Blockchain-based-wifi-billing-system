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
  user1: "0xC4Deb43c6B729cA2EA7508E5f4C39f0129A93E5d",
  user2: "0x8D4d45c7b26169E51ca8cab6AfB1058a8B10889e",
  user3: "0x73455945eF835c5E4cBd4bDa6a300A8eA632F843",
};

// Invert the mapping to get username from address
const ADDRESS_TO_USERNAME = Object.fromEntries(
  Object.entries(USER_ADDRESS_MAPPING).map(([username, address]) => [address.toLowerCase(), username])
);

const ISPDashboard = () => {
  const [users, setUsers] = useState([]);
  const [totalUsageData, setTotalUsageData] = useState([]);
  const [cumulativeUsage, setCumulativeUsage] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [error, setError] = useState("");
  const [contract, setContract] = useState(null);
  const [signer, setSigner] = useState(null);
  const [ispAddress, setIspAddress] = useState("");
  const navigate = useNavigate();

  // Initialize ethers.js and connect to Ganache
  useEffect(() => {
    const initBlockchain = async () => {
      try {
        if (!Array.isArray(wiFiBillingABI)) {
          throw new Error("Invalid ABI: ABI must be an array");
        }

        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:7545", {
          chainId: 1337,
          name: "ganache",
          ensAddress: null,
        });
        const signer = await provider.getSigner(0);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

        setContract(contract);
        setSigner(signer);

        const address = await signer.getAddress();
        setIspAddress(address);
      } catch (err) {
        setError("Failed to connect to blockchain: " + err.message);
        console.error(err);
      }
    };
    initBlockchain();
  }, []);

  // Fetch all users' data from the blockchain
  const fetchAllUsersData = async () => {
    if (!contract) {
      console.warn("Cannot fetch users' data: Contract not set");
      return;
    }
    try {
      const userAddresses = Object.values(USER_ADDRESS_MAPPING);
      const usersData = await Promise.all(
        userAddresses.map(async (address) => {
          const [totalUsage, totalCost] = await contract.generateBillingReport(address);
          const tokenBalance = await contract.tokenBalances(address);
          return {
            address,
            username: ADDRESS_TO_USERNAME[address.toLowerCase()] || "Unknown",
            totalUsage: Number(totalUsage),
            totalCost: Number(totalCost),
            tokenBalance: Number(tokenBalance),
          };
        })
      );
      setUsers(usersData);
    } catch (err) {
      setError("Failed to fetch users' data: " + err.message);
      console.error(err);
    }
  };

  // Fetch total data usage history from the database (FastAPI backend)
  const fetchTotalDataUsageFromDB = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }
      console.log("Fetching total data usage with token:", token);

      const response = await fetch("http://127.0.0.1:8000/isp/data-usage", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      console.log("Response status:", response.status);
      if (response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired or access denied. Please log in again.");
      }
      if (!response.ok) {
        const errorData = await response.json();
        console.log("Error response:", errorData);
        throw new Error("Failed to fetch total data usage from database: " + (errorData.detail || response.statusText));
      }

      const data = await response.json();
      setTotalUsageData(data);

      let cumulative = 0;
      const cumulativeData = data.map((entry) => {
        cumulative += entry.total_usage_mb;
        return { ...entry, cumulative_mb: cumulative };
      });
      setCumulativeUsage(cumulativeData);
    } catch (err) {
      setError("Failed to fetch total data usage from database: " + err.message);
      console.error(err);
    }
  };

  // Fetch all transactions from the blockchain
  const fetchAllTransactions = async () => {
    if (!contract) {
      console.warn("Cannot fetch transactions: Contract not set");
      return;
    }
    try {
      const userAddresses = Object.values(USER_ADDRESS_MAPPING);
      console.log("Fetching transactions for addresses:", userAddresses);
      userAddresses.forEach((address) => {
        try {
          ethers.getAddress(address);
        } catch (err) {
          throw new Error(`Invalid Ethereum address in USER_ADDRESS_MAPPING: ${address}`);
        }
      });

      const allTxs = await Promise.all(
        userAddresses.map(async (address) => {
          console.log(`Calling getTransactions for address: ${address}`);
          const txs = await contract.getTransactions(address);
          return txs.map((tx) => ({
            userAddress: address,
            username: ADDRESS_TO_USERNAME[address.toLowerCase()] || "Unknown",
            id: Number(tx.id),
            amount: Number(tx.amount),
            timestamp: new Date(Number(tx.timestamp) * 1000).toISOString().replace("T", " ").substring(0, 19),
            status: tx.status,
          }));
        })
      );
      const flattenedTxs = allTxs.flat();
      setAllTransactions(flattenedTxs);
    } catch (err) {
      setError("Failed to fetch transactions: " + err.message);
      console.error(err);
    }
  };

  // Mint tokens for a specific user
  const handleMintTokens = async (userAddress, amount) => {
    if (!contract) {
      setError("Cannot mint tokens: Blockchain not connected");
      return;
    }
    try {
      const tx = await contract.mintTokens(userAddress, amount);
      await tx.wait();
      await fetchAllUsersData();
      alert(`Successfully minted ${amount} WiFiTokens for ${ADDRESS_TO_USERNAME[userAddress.toLowerCase()] || userAddress}!`);
    } catch (err) {
      setError("Failed to mint tokens: " + err.message);
      console.error(err);
    }
  };

  // Log data usage for a specific user
  const handleLogDataUsage = async (userAddress, usage_mb) => {
    if (!contract) {
      setError("Cannot log data usage: Blockchain not connected");
      return;
    }
    try {
      const tx = await contract.logDataUsage(userAddress, usage_mb);
      await tx.wait();

      const token = localStorage.getItem("token");
      if (token) {
        await fetch("http://127.0.0.1:8000/isp/log-data-usage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ username: ADDRESS_TO_USERNAME[userAddress.toLowerCase()], usage_mb }),
        });
      }

      await fetchAllUsersData();
      await fetchTotalDataUsageFromDB();
    } catch (err) {
      setError("Failed to log data usage: " + err.message);
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
      await fetchAllUsersData();
      await fetchTotalDataUsageFromDB();
      await fetchAllTransactions();
    };
    fetchAllData();

    const interval = setInterval(fetchAllData, 10000);
    return () => clearInterval(interval);
  }, [contract]);

  const chartData = cumulativeUsage.map((entry) => ({
    timestamp: entry.timestamp,
    total_usage_mb: entry.total_usage_mb,
    cumulative_mb: entry.cumulative_mb,
  }));

  return (
    <div className="min-h-screen p-8 bg-gray-900">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">ISP Dashboard</h1>
        <button
          onClick={handleLogout}
          className="bg-red-500 text-white py-2 px-4 rounded-full hover:bg-red-600 transition duration-300"
        >
          Logout
        </button>
      </div>

      {error && (
        <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-2">
          <h2 className="text-2xl font-semibold text-white mb-4">Total Data Usage History (All Users)</h2>
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
                    dataKey="total_usage_mb"
                    stroke="#8884d8"
                    strokeWidth={3}
                    activeDot={{ r: 8 }}
                    name="Total Usage (MB)"
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulative_mb"
                    stroke="#82ca9d"
                    strokeWidth={3}
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

        <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col">
          <h2 className="text-2xl font-semibold text-white mb-4">Network Stats</h2>
          <div className="text-gray-300 flex-1">
            <p>Active Users: <span className="font-bold text-white">{users.length}</span></p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-4">
          <h2 className="text-2xl font-semibold text-white mb-4">Users Overview</h2>
          {users.length > 0 ? (
            <div className="overflow-y-auto flex-1">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Username</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Address</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Total Usage (MB)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Total Cost (KES)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Token Balance</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.address} className="bg-gray-600">
                      <td className="border border-gray-600 p-3 text-white">{user.username}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.address}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.totalUsage}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.totalCost}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.tokenBalance}</td>
                      <td className="border border-gray-600 p-3 text-white">
                        <button
                          onClick={() => handleMintTokens(user.address, 1000)}
                          className="bg-yellow-500 text-white py-1 px-2 rounded-full hover:bg-yellow-600 transition duration-300 mr-2"
                        >
                          Mint 1000 Tokens
                        </button>
                        <button
                          onClick={() => handleLogDataUsage(user.address, 50)}
                          className="bg-green-500 text-white py-1 px-2 rounded-full hover:bg-green-600 transition duration-300"
                        >
                          Log 50 MB
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300 flex-1">No users available.</p>
          )}
        </div>

        <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-4">
          <h2 className="text-2xl font-semibold text-white mb-4">Transaction History (All Users)</h2>
          {allTransactions.length > 0 ? (
            <div className="overflow-y-auto flex-1">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Username</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">User Address</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Transaction ID</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Amount (KES)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Timestamp</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allTransactions.map((tx) => (
                    <tr key={`${tx.userAddress}-${tx.id}`} className="bg-gray-600">
                      <td className="border border-gray-600 p-3 text-white">{tx.username}</td>
                      <td className="border border-gray-600 p-3 text-white">{tx.userAddress}</td>
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

export default ISPDashboard;