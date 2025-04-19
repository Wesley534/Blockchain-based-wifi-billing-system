import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import wiFiBillingArtifact from "../utils/WiFiBilling.json";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Extract the ABI from the artifact
const wiFiBillingABI = wiFiBillingArtifact.abi;

// Smart contract address (from your deployment)
const CONTRACT_ADDRESS = "0x0eB663F7c4b4cF38Ee264eA736a21eF7a9FB79D8";

const ISPDashboard = () => {
  const [users, setUsers] = useState([]);
  const [totalUsageData, setTotalUsageData] = useState([]);
  const [cumulativeUsage, setCumulativeUsage] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [wifiPlans, setWifiPlans] = useState([]);
  const [newPlan, setNewPlan] = useState({ name: "", duration: "hourly", price_kes: "", data_mb: "" });
  const [editingPlan, setEditingPlan] = useState(null);
  const [error, setError] = useState("");
  const [contract, setContract] = useState(null);
  const [signer, setSigner] = useState(null);
  const [ispAddress, setIspAddress] = useState("");
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const navigate = useNavigate();

  // Initialize ethers.js and check MetaMask connection
  useEffect(() => {
    const checkWalletConnection = async () => {
      if (!window.ethereum) {
        setError("MetaMask is not installed. Please install MetaMask to continue.");
        return;
      }

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
          const signer = await provider.getSigner();
          const address = await signer.getAddress();
          const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

          setSigner(signer);
          setIspAddress(ethers.getAddress(address));
          setContract(contract);
          setIsWalletConnected(true);

          // Update wallet address in backend
          await updateWalletAddress(address);

          // Fetch data
          await fetchAllData();
        }
      } catch (err) {
        setError("Failed to initialize blockchain connection: " + err.message);
        console.error(err);
      }
    };
    checkWalletConnection();

    // Listen for account changes in MetaMask
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accounts) => {
        if (accounts.length > 0) {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          const address = await signer.getAddress();
          const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

          setSigner(signer);
          setIspAddress(ethers.getAddress(address));
          setContract(contract);
          setIsWalletConnected(true);

          // Update wallet address in backend
          await updateWalletAddress(address);

          // Refresh data
          await fetchAllData();
        } else {
          setIsWalletConnected(false);
          setIspAddress("");
          setContract(null);
          setSigner(null);
        }
      });
    }

    // Cleanup event listener
    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener("accountsChanged", () => {});
      }
    };
  }, []);

  // Handle MetaMask wallet connection
  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("MetaMask is not installed. Please install MetaMask to continue.");
      return;
    }

    setIsConnecting(true);
    setError("");
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

      setSigner(signer);
      setIspAddress(ethers.getAddress(address));
      setContract(contract);
      setIsWalletConnected(true);

      // Update wallet address in backend
      await updateWalletAddress(address);

      // Fetch data after connecting
      await fetchAllData();
    } catch (err) {
      if (err.code === 4001) {
        setError("Wallet connection rejected by user.");
      } else {
        setError("Failed to connect wallet: " + err.message);
      }
      console.error(err);
    } finally {
      setIsConnecting(false);
    }
  };

  // Update wallet address in the backend
  const updateWalletAddress = async (walletAddress) => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch("http://127.0.0.1:8000/update-wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ wallet_address: walletAddress }),
      });

      if (!response.ok) {
        throw new Error("Failed to update wallet address in backend");
      }
    } catch (err) {
      setError("Failed to update wallet address: " + err.message);
      console.error(err);
    }
  };

  // Fetch all users' data from the backend
  const fetchAllUsersData = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch("http://127.0.0.1:8000/isp/users", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired or access denied. Please log in again.");
      }
      if (!response.ok) {
        throw new Error("Failed to fetch users' data");
      }

      const usersData = await response.json();
      if (contract) {
        const enrichedUsers = await Promise.all(
          usersData.map(async (user) => {
            if (user.wallet_address) {
              const [totalUsage, totalCost] = await contract.generateBillingReport(user.wallet_address);
              const tokenBalance = await contract.tokenBalances(user.wallet_address);
              return {
                ...user,
                totalUsage: Number(totalUsage),
                totalCost: Number(totalCost),
                tokenBalance: Number(tokenBalance),
              };
            }
            return { ...user, totalUsage: 0, totalCost: 0, tokenBalance: 0 };
          })
        );
        setUsers(enrichedUsers);
      } else {
        setUsers(usersData.map((user) => ({ ...user, totalUsage: 0, totalCost: 0, tokenBalance: 0 })));
      }
    } catch (err) {
      setError("Failed to fetch users' data: " + err.message);
      console.error(err);
    }
  };

  // Fetch total data usage history from the database
  const fetchTotalDataUsageFromDB = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch("http://127.0.0.1:8000/isp/data-usage", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired or access denied. Please log in again.");
      }
      if (!response.ok) {
        throw new Error("Failed to fetch total data usage from database");
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
    if (!contract || !users.length) {
      console.warn("Cannot fetch transactions: Contract or users not set");
      return;
    }
    try {
      const userAddresses = users
        .filter((user) => user.wallet_address)
        .map((user) => user.wallet_address);
      const allTxs = await Promise.all(
        userAddresses.map(async (address) => {
          const txs = await contract.getTransactions(address);
          return txs.map((tx) => ({
            userAddress: address,
            username: users.find((u) => u.wallet_address === address)?.username || "Unknown",
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

  // Fetch WiFi plans from the backend
  const fetchWifiPlans = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch("http://127.0.0.1:8000/isp/wifi-plans", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired or access denied. Please log in again.");
      }
      if (!response.ok) {
        throw new Error("Failed to fetch WiFi plans");
      }

      const data = await response.json();
      setWifiPlans(data);
    } catch (err) {
      setError("Failed to fetch WiFi plans: " + err.message);
      console.error(err);
    }
  };

  // Create a new WiFi plan
  const handleCreatePlan = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch("http://127.0.0.1:8000/isp/wifi-plans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newPlan.name,
          duration: newPlan.duration,
          price_kes: parseFloat(newPlan.price_kes),
          data_mb: parseInt(newPlan.data_mb),
        }),
      });

      if (response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired or access denied. Please log in again.");
      }
      if (!response.ok) {
        throw new Error("Failed to create WiFi plan");
      }

      setNewPlan({ name: "", duration: "hourly", price_kes: "", data_mb: "" });
      await fetchWifiPlans();
      alert("WiFi plan created successfully!");
    } catch (err) {
      setError("Failed to create WiFi plan: " + err.message);
      console.error(err);
    }
  };

  // Edit an existing WiFi plan
  const handleEditPlan = async (e, planId) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch(`http://127.0.0.1:8000/isp/wifi-plans/${planId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newPlan.name,
          duration: newPlan.duration,
          price_kes: parseFloat(newPlan.price_kes),
          data_mb: parseInt(newPlan.data_mb),
        }),
      });

      if (response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired or access denied. Please log in again.");
      }
      if (!response.ok) {
        throw new Error("Failed to update WiFi plan");
      }

      setEditingPlan(null);
      setNewPlan({ name: "", duration: "hourly", price_kes: "", data_mb: "" });
      await fetchWifiPlans();
      alert("WiFi plan updated successfully!");
    } catch (err) {
      setError("Failed to update WiFi plan: " + err.message);
      console.error(err);
    }
  };

  // Delete a WiFi plan
  const handleDeletePlan = async (planId) => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch(`http://127.0.0.1:8000/isp/wifi-plans/${planId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired or access denied. Please log in again.");
      }
      if (!response.ok) {
        throw new Error("Failed to delete WiFi plan");
      }

      await fetchWifiPlans();
      alert("WiFi plan deleted successfully!");
    } catch (err) {
      setError("Failed to delete WiFi plan: " + err.message);
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
      alert(`Successfully minted ${amount} WiFiTokens for user!`);
    } catch (err) {
      setError("Failed to mint tokens: " + err.message);
      console.error(err);
    }
  };

  // Log data usage for a specific user
  const handleLogDataUsage = async (username, userAddress, usage_mb) => {
    if (!contract) {
      setError("Cannot log data usage: Blockchain not connected");
      return;
    }
    try {
      const tx = await contract.logDataUsage(userAddress, usage_mb);
      await tx.wait();

      const token = localStorage.getItem("token");
      if (token) {
        const response = await fetch("http://127.0.0.1:8000/isp/log-data-usage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ username, usage_mb }),
        });
        if (!response.ok) {
          throw new Error("Failed to log data usage to database");
        }
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

  // Fetch all data
  const fetchAllData = async () => {
    await fetchAllUsersData();
    await fetchTotalDataUsageFromDB();
    await fetchAllTransactions();
    await fetchWifiPlans();
  };

  // Fetch data on component mount and set up polling
  useEffect(() => {
    if (isWalletConnected) {
      fetchAllData();
      const interval = setInterval(fetchAllData, 10000);
      return () => clearInterval(interval);
    }
  }, [isWalletConnected, contract]);

  // Prepare data for the line graph
  const chartData = cumulativeUsage.map((entry) => ({
    timestamp: entry.timestamp,
    total_usage_mb: entry.total_usage_mb,
    cumulative_mb: entry.cumulative_mb,
  }));

  // Calculate Y-axis domain for dynamic scaling
  const yAxisDomain = chartData.length > 0 ? [
    Math.min(...chartData.map((d) => Math.min(d.total_usage_mb, d.cumulative_mb))) * 0.95,
    Math.max(...chartData.map((d) => Math.max(d.total_usage_mb, d.cumulative_mb))) * 1.05,
  ] : [0, 100];

  return (
    <div className="min-h-screen p-8 bg-gray-900">
      {/* Header with Connect Wallet and Logout Buttons */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">ISP Dashboard</h1>
        <div className="flex space-x-4">
          {!isWalletConnected ? (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className={`bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300 ${
                isConnecting ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {isConnecting ? "Connecting..." : "Connect MetaMask"}
            </button>
          ) : (
            <span className="text-white py-2 px-4">
              Connected: {ispAddress.slice(0, 6)}...{ispAddress.slice(-4)}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="bg-red-500 text-white py-2 px-4 rounded-full hover:bg-red-600 transition duration-300"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
          <p>{error}</p>
        </div>
      )}

      {/* Prompt if Wallet Not Connected */}
      {!isWalletConnected && (
        <div className="mb-8 p-6 bg-gray-800 rounded-lg shadow-lg text-center">
          <p className="text-white mb-4">Please connect your MetaMask wallet to view your dashboard.</p>
          <button
            onClick={connectWallet}
            disabled={isConnecting}
            className={`bg-blue-500 text-white py-2 px-6 rounded-full hover:bg-blue-600 transition duration-300 ${
              isConnecting ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {isConnecting ? "Connecting..." : "Connect MetaMask"}
          </button>
        </div>
      )}

      {/* Dashboard Content */}
      {isWalletConnected && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Total Data Usage History */}
          <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-2">
            <h2 className="text-2xl font-semibold text-white mb-4">Total Data Usage History (All Users)</h2>
            <div className="flex-1">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                    <XAxis dataKey="timestamp" stroke="#ccc" tick={{ fill: "#ccc", fontSize: 12 }} />
                    <YAxis domain={yAxisDomain} stroke="#ccc" tick={{ fill: "#ccc", fontSize: 12 }} />
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

          {/* Network Stats */}
          <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col">
            <h2 className="text-2xl font-semibold text-white mb-4">Network Stats</h2>
            <div className="text-gray-300 flex-1">
              <p>
                Active Users: <span className="font-bold text-white">{users.length}</span>
              </p>
            </div>
          </div>

          {/* WiFi Plans Management */}
          <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-4">
            <h2 className="text-2xl font-semibold text-white mb-4">Manage WiFi Plans</h2>
            <form
              onSubmit={(e) => (editingPlan ? handleEditPlan(e, editingPlan.id) : handleCreatePlan(e))}
              className="mb-4 flex flex-col space-y-4"
            >
              <div className="flex space-x-4">
                <input
                  type="text"
                  placeholder="Plan Name"
                  value={newPlan.name}
                  onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
                  className="bg-gray-700 text-white p-2 rounded flex-1"
                  required
                />
                <select
                  value={newPlan.duration}
                  onChange={(e) => setNewPlan({ ...newPlan, duration: e.target.value })}
                  className="bg-gray-700 text-white p-2 rounded"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="flex space-x-4">
                <input
                  type="number"
                  placeholder="Price (KES)"
                  value={newPlan.price_kes}
                  onChange={(e) => setNewPlan({ ...newPlan, price_kes: e.target.value })}
                  className="bg-gray-700 text-white p-2 rounded flex-1"
                  required
                  min="0"
                  step="0.01"
                />
                <input
                  type="number"
                  placeholder="Data (MB)"
                  value={newPlan.data_mb}
                  onChange={(e) => setNewPlan({ ...newPlan, data_mb: e.target.value })}
                  className="bg-gray-700 text-white p-2 rounded flex-1"
                  required
                  min="0"
                />
              </div>
              <button
                type="submit"
                className="bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300"
              >
                {editingPlan ? "Update Plan" : "Create Plan"}
              </button>
              {editingPlan && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingPlan(null);
                    setNewPlan({ name: "", duration: "hourly", price_kes: "", data_mb: "" });
                  }}
                  className="bg-gray-500 text-white py-2 px-4 rounded-full hover:bg-gray-600 transition duration-300"
                >
                  Cancel
                </button>
              )}
            </form>
            <div className="overflow-y-auto flex-1">
              {wifiPlans.length > 0 ? (
                <table className="w-full border-collapse border border-gray-600">
                  <thead>
                    <tr className="bg-gray-700">
                      <th className="border border-gray-600 p-3 text-left text-gray-300">Name</th>
                      <th className="border border-gray-600 p-3 text-left text-gray-300">Duration</th>
                      <th className="border border-gray-600 p-3 text-left text-gray-300">Price (KES)</th>
                      <th className="border border-gray-600 p-3 text-left text-gray-300">Data (MB)</th>
                      <th className="border border-gray-600 p-3 text-left text-gray-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wifiPlans.map((plan) => (
                      <tr key={plan.id} className="bg-gray-600">
                        <td className="border border-gray-600 p-3 text-white">{plan.name}</td>
                        <td className="border border-gray-600 p-3 text-white">{plan.duration}</td>
                        <td className="border border-gray-600 p-3 text-white">{plan.price_kes}</td>
                        <td className="border border-gray-600 p-3 text-white">{plan.data_mb}</td>
                        <td className="border border-gray-600 p-3 text-white">
                          <button
                            onClick={() => {
                              setEditingPlan(plan);
                              setNewPlan({
                                name: plan.name,
                                duration: plan.duration,
                                price_kes: plan.price_kes.toString(),
                                data_mb: plan.data_mb.toString(),
                              });
                            }}
                            className="bg-yellow-500 text-white py-1 px-2 rounded-full hover:bg-yellow-600 transition duration-300 mr-2"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeletePlan(plan.id)}
                            className="bg-red-500 text-white py-1 px-2 rounded-full hover:bg-red-600 transition duration-300"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-300">No WiFi plans available.</p>
              )}
            </div>
          </div>

          {/* Users Overview */}
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
                      <tr key={user.id} className="bg-gray-600">
                        <td className="border border-gray-600 p-3 text-white">{user.username}</td>
                        <td className="border border-gray-600 p-3 text-white">{user.wallet_address || "Not set"}</td>
                        <td className="border border-gray-600 p-3 text-white">{user.totalUsage}</td>
                        <td className="border border-gray-600 p-3 text-white">{user.totalCost}</td>
                        <td className="border border-gray-600 p-3 text-white">{user.tokenBalance}</td>
                        <td className="border border-gray-600 p-3 text-white">
                          <button
                            onClick={() => handleMintTokens(user.wallet_address, 1000)}
                            className="bg-yellow-500 text-white py-1 px-2 rounded-full hover:bg-yellow-600 transition duration-300 mr-2"
                            disabled={!user.wallet_address}
                          >
                            Mint 1000 Tokens
                          </button>
                          <button
                            onClick={() => handleLogDataUsage(user.username, user.wallet_address, 50)}
                            className="bg-green-500 text-white py-1 px-2 rounded-full hover:bg-green-600 transition duration-300"
                            disabled={!user.wallet_address}
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

          {/* Transaction History */}
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
      )}
    </div>
  );
};

export default ISPDashboard;