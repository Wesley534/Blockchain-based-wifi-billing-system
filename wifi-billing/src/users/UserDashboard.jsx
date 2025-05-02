import { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { WalletContext } from "../context/WalletContext";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Footer from "../components/Footer";

const UserDashboard = () => {
  const [dataUsage, setDataUsage] = useState([]);
  const [totalUsage, setTotalUsage] = useState(0);
  const [cumulativeUsage, setCumulativeUsage] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [billingReport, setBillingReport] = useState({ total_usage_mb: 0, total_cost_kes: 0 });
  const [localError, setLocalError] = useState("");
  const [isSimulatingPayment, setIsSimulatingPayment] = useState(false);
  const navigate = useNavigate();
  const {
    isWalletConnected,
    userAddress,
    contract,
    isConnecting,
    connectWallet,
    disconnectWallet,
    error: walletError,
    setError: setWalletError,
  } = useContext(WalletContext);

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setLocalError("Please log in to access the dashboard.");
        navigate("/");
        return;
      }

      try {
        const response = await fetch("http://127.0.0.1:8000/verify-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.status === 401) {
          localStorage.removeItem("access_token");
          localStorage.removeItem("username");
          setLocalError("Session expired. Please log in again.");
          await disconnectWallet();
          navigate("/");
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to verify token: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.role !== "user") {
          setLocalError("Access denied. User role required.");
          navigate("/");
        }
      } catch (err) {
        setLocalError(`Failed to verify session: ${err.message}`);
        localStorage.removeItem("access_token");
        localStorage.removeItem("username");
        await disconnectWallet();
        navigate("/");
      }
    };

    checkAuth();
  }, [navigate, disconnectWallet]);

  // Fetch data usage from database
  const fetchDataUsageFromDB = async () => {
    try {
      const token = localStorage.getItem("access_token");
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
      if (response.status === 403) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired or access denied. Please log in again.");
      }
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to fetch data usage from database");
      }

      const data = await response.json();
      setDataUsage(data);

      const total = data.reduce((sum, entry) => sum + Math.floor(Number(entry.usage_mb)), 0);
      setTotalUsage(total);

      let cumulative = 0;
      const cumulativeData = data.map((entry) => {
        const usage_mb = Math.floor(Number(entry.usage_mb));
        cumulative += usage_mb;
        return { ...entry, usage_mb, cumulative_mb: cumulative };
      });
      setCumulativeUsage(cumulativeData);
    } catch (err) {
      setLocalError("Failed to fetch data usage from database: " + err.message);
      console.error("Fetch data usage error:", err);
    }
  };

  // Fetch data usage from blockchain
  const fetchDataUsageFromBlockchain = async () => {
    if (!contract || !userAddress || !isWalletConnected) {
      console.warn("Cannot fetch blockchain data: Missing contract or user address");
      return [];
    }
    try {
      console.log(`Fetching blockchain data usage for address: ${userAddress}`);
      const data = await contract.getDataUsage(userAddress);
      const formattedData = data.map((entry) => ({
        usage_mb: Number(entry.usageMB),
        timestamp: new Date(Number(entry.timestamp) * 1000).toISOString().replace("T", " ").substring(0, 19),
      }));
      console.log(`Blockchain data usage for ${userAddress}:`, formattedData);
      return formattedData;
    } catch (err) {
      let errorMessage = "Failed to fetch data usage from blockchain";
      if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Possible user not registered"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setWalletError(errorMessage);
      console.error(`Fetch blockchain data error for ${userAddress}:`, err);
      return [];
    }
  };

  // Fetch transactions
  const fetchTransactions = async () => {
    if (!contract || !userAddress || !isWalletConnected) {
      console.warn("Cannot fetch transactions: Missing contract or user address");
      return;
    }
    try {
      console.log(`Fetching transactions for address: ${userAddress}`);
      const txs = await contract.getTransactions(userAddress);
      const formattedTxs = txs.map((tx) => ({
        id: Number(tx.id),
        amount: Number(tx.amount),
        timestamp: new Date(Number(tx.timestamp) * 1000).toISOString().replace("T", " ").substring(0, 19),
        status: tx.status,
      }));
      setTransactions(formattedTxs);
      console.log(`Transactions for ${userAddress}:`, formattedTxs);
    } catch (err) {
      let errorMessage = "Failed to fetch transactions";
      if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Possible user not registered"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setWalletError(errorMessage);
      console.error(`Fetch transactions error for ${userAddress}:`, err);
    }
  };

  // Fetch billing report
  const fetchBillingReport = async () => {
    if (!contract || !userAddress || !isWalletConnected) {
      console.warn("Cannot fetch billing report: Missing contract or user address");
      return;
    }
    try {
      console.log(`Fetching billing report for address: ${userAddress}`);
      const [totalUsage, totalCost] = await contract.generateBillingReport(userAddress);
      const report = {
        total_usage_mb: Number(totalUsage) || 0,
        total_cost_kes: Number(totalCost) || 0,
      };
      setBillingReport(report);
      console.log(`Billing report for ${userAddress}:`, report);
    } catch (err) {
      let errorMessage = "Failed to fetch billing report";
      if (err.code === "BAD_DATA" && err.message.includes("could not decode result data")) {
        errorMessage = "Unable to fetch billing report (possible contract error)";
      } else if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Possible user not registered"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setWalletError(errorMessage);
      setBillingReport({ total_usage_mb: 0, total_cost_kes: 0 });
      console.error(`Fetch billing report error for ${userAddress}:`, err);
    }
  };

  // Log data usage
  const handleLogDataUsage = async (usage_mb) => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const usage_mb_int = Math.floor(Number(usage_mb));
      if (usage_mb_int <= 0) {
        throw new Error("Invalid data usage value. Please enter a positive integer.");
      }

      const response = await fetch("http://127.0.0.1:8000/data-usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ usage_mb: usage_mb_int }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to log data usage to database");
      }

      if (contract && userAddress) {
        console.log(`Logging data usage: ${usage_mb_int} MB for ${userAddress}`);
        const tx = await contract.logDataUsage(usage_mb_int);
        await tx.wait();
        console.log(`Data usage logged on blockchain for ${userAddress}`);
      }

      await fetchDataUsageFromDB();
      if (contract && userAddress) {
        await fetchDataUsageFromBlockchain();
      }
      alert(`Successfully logged ${usage_mb_int} MB of data usage!`);
    } catch (err) {
      let errorMessage = "Failed to log data usage";
      if (err.code === 4001) {
        errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      } else if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Check contract state"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setWalletError(errorMessage);
      console.error(`Log data usage error for ${userAddress}:`, err);
    }
  };

  // Simulate payment
  const handleSimulatePayment = async () => {
    if (!contract || !userAddress || !isWalletConnected) {
      setWalletError("Cannot simulate payment: Please connect your wallet");
      return;
    }
    setIsSimulatingPayment(true);
    setWalletError("");
    try {
      const totalUsageInt = Math.floor(Number(totalUsage));
      if (totalUsageInt <= 0) {
        throw new Error("Invalid total usage value. Please log some data usage first.");
      }

      console.log(`Fetching costPerMB for payment simulation`);
      const costPerMB = Number(await contract.costPerMB());
      if (isNaN(costPerMB) || costPerMB <= 0) {
        throw new Error("Invalid cost per MB from contract. Please contact the ISP or initialize costPerMB.");
      }

      console.log(`Calling makePayment with: ${totalUsageInt}`);
      const tx = await contract.makePayment(totalUsageInt);
      await tx.wait();

      await fetchDataUsageFromDB();
      await fetchTransactions();
      await fetchBillingReport();

      alert("Payment simulated successfully!");
    } catch (err) {
      let errorMessage = "Failed to simulate payment";
      if (err.code === 4001) {
        errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      } else if (err.code === "INVALID_ARGUMENT" && err.message.includes("underflow")) {
        errorMessage = "Invalid usage value. Please ensure data usage is a whole number.";
      } else if (err.code === "BAD_DATA" && err.message.includes("could not decode result data")) {
        errorMessage = "Unable to process payment (possible contract error)";
      } else if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Check contract state"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setWalletError(errorMessage);
      console.error(`Simulate payment error for ${userAddress}:`, err);
    } finally {
      setIsSimulatingPayment(false);
    }
  };

  // Fetch all data
  const fetchAllData = async () => {
    if (!isWalletConnected || !contract || !userAddress) {
      console.log("Skipping data fetch: Wallet not connected or contract/userAddress missing");
      return;
    }
    console.log(`Fetching all data for ${userAddress}`);
    await fetchDataUsageFromDB();
    try {
      let isRegistered = false;
      try {
        isRegistered = await contract.isUserRegistered(userAddress);
      } catch (err) {
        if (err.code === "CALL_EXCEPTION") {
          console.warn(`User ${userAddress} not registered`);
        } else {
          throw err;
        }
      }

      if (!isRegistered) {
        setWalletError("User not registered on blockchain. Please contact your ISP to register your account.");
        return;
      }

      await fetchTransactions();
      await fetchBillingReport();
    } catch (err) {
      let errorMessage = "Failed to fetch blockchain data";
      if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Possible user not registered or contract issue"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setWalletError(errorMessage);
      console.error(`Fetch all data error for ${userAddress}:`, err);
    }
  };

  // Fetch data when wallet connects
  useEffect(() => {
    if (isWalletConnected && contract && userAddress) {
      fetchAllData();
    }
  }, [isWalletConnected, contract, userAddress]);

  // Handle logout
  const handleLogout = async () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("username");
    await disconnectWallet();
    navigate("/");
  };

  // Chart data
  const chartData = cumulativeUsage.map((entry) => ({
    timestamp: entry.timestamp,
    usage_mb: entry.usage_mb,
    cumulative_mb: entry.cumulative_mb,
  }));

  // Calculate Y-axis domain for dynamic scaling
  const yAxisDomain = chartData.length > 0
    ? [
        Math.min(...chartData.map((d) => Math.min(d.usage_mb, d.cumulative_mb))) * 0.95,
        Math.max(...chartData.map((d) => Math.max(d.usage_mb, d.cumulative_mb))) * 1.05,
      ]
    : [0, 100];

  return (
    <><div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">User Dashboard</h1>
        <div className="flex space-x-4 items-center">
          {isWalletConnected && userAddress ? (
            <>
              <span className="text-white py-2 px-4">
                Connected: {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
              </span>
              <button
                onClick={disconnectWallet}
                className="bg-yellow-500 text-white py-2 px-4 rounded-full hover:bg-yellow-600 transition duration-300"
              >
                Disconnect Wallet
              </button>
            </>
          ) : null}
          <button
            onClick={connectWallet}
            className="bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300"
            disabled={isConnecting}
          >
            {isConnecting ? "Connecting..." : isWalletConnected ? "Update Wallet Address" : "Connect MetaMask"}
          </button>
          <button
            onClick={() => navigate("/wifi-plans")}
            className="bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
          >
            View WiFi Plans
          </button>
          <button
            onClick={handleLogout}
            className="bg-red-500 text-white py-2 px-4 rounded-full hover:bg-red-600 transition duration-300"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Error Message */}
      {(localError || walletError) && (
        <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
          <p>{localError || walletError}</p>
          <button
            onClick={() => {
              setLocalError("");
              setWalletError("");
            } }
            className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
          >
            Clear Error
          </button>
        </div>
      )}

      {/* Wallet Connection Prompt */}
      {!isWalletConnected && (
        <div className="mb-8 p-6 bg-gray-800 rounded-lg shadow-lg text-center">
          <p className="text-white mb-4">
            {window.ethereum
              ? "Connect your MetaMask wallet to Ganache to access blockchain features."
              : "MetaMask is not installed. Please install MetaMask and connect to Ganache."}
          </p>
          {window.ethereum && (
            <button
              onClick={connectWallet}
              className="bg-blue-500 text-white py-2 px-6 rounded-full hover:bg-blue-600 transition duration-300"
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect MetaMask"}
            </button>
          )}
        </div>
      )}

      {/* Dashboard Content */}
      {isWalletConnected && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            </div>
          </div>

          {/* Data Usage History Card */}
          <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-2">
            <h2 className="text-2xl font-semibold text-white mb-4">Data Usage History (Real-Time)</h2>
            <p className="mb-4 text-gray-300">
              Current Session Usage: <span className="font-bold text-white">{totalUsage} MB</span>
            </p>
            <div className="mb-4">
              <button
                onClick={() => handleLogDataUsage(50)}
                className="bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
                disabled={isSimulatingPayment || !isWalletConnected || isConnecting}
              >
                Log 50 MB Usage (Test)
              </button>
            </div>
            <div className="flex-1">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                    <XAxis dataKey="timestamp" stroke="#ccc" tick={{ fill: "#ccc", fontSize: 12 }} />
                    <YAxis domain={yAxisDomain} stroke="#ccc" tick={{ fill: "#ccc", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#333", border: "none", color: "#fff" }}
                      labelStyle={{ color: "#fff" }} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="usage_mb"
                      stroke="#8884d8"
                      strokeWidth={3}
                      activeDot={{ r: 8 }}
                      name="Usage (MB)" />
                    <Line
                      type="monotone"
                      dataKey="cumulative_mb"
                      stroke="#82ca9d"
                      strokeWidth={3}
                      activeDot={{ r: 8 }}
                      name="Cumulative Usage (MB)" />
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
                onClick={handleSimulatePayment}
                className="bg-blue-500 text-white py-3 px-6 rounded-full hover:bg-blue-600 transition duration-300"
                disabled={totalUsage === 0 || !isWalletConnected || isSimulatingPayment || isConnecting}
              >
                {isSimulatingPayment ? "Processing..." : "Simulate Payment"}
              </button>
            </div>
          </div>

          {/* Transaction History Card */}
          <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col lg:col-span-2">
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
      )}
    </div><Footer /></>

  );
};

export default UserDashboard;