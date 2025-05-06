import { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { WalletContext } from "../context/WalletContext";
import { getEthToKesRate } from "../utils/exchangeRate";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { jsPDF } from "jspdf";
import Footer from "../components/Footer";

const ISPDashboard = () => {
  const {
    isWalletConnected,
    userAddress,
    contract,
    signer,
    error: walletError,
    setError: setWalletError,
    isConnecting,
    isISP,
    connectWallet,
    disconnectWallet,
    updateWalletAddress,
  } = useContext(WalletContext);

  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingRegistrations, setPendingRegistrations] = useState([]);
  const [totalUsageData, setTotalUsageData] = useState([]);
  const [cumulativeUsage, setCumulativeUsage] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [wifiPlans, setWifiPlans] = useState([]);
  const [newPlan, setNewPlan] = useState({ name: "", duration: "hourly", price_kes: "", data_mb: "" });
  const [editingPlan, setEditingPlan] = useState(null);
  const [error, setError] = useState("");
  const [isLoggingData, setIsLoggingData] = useState(false);
  const [isConfirmingRegistration, setIsConfirmingRegistration] = useState(false);
  const [isRejectingRegistration, setIsRejectingRegistration] = useState(false); // New state for rejecting
  const [isLoading, setIsLoading] = useState(false);
  const [ethToKesRate, setEthToKesRate] = useState(247789.20);
  const [reportType, setReportType] = useState("daily"); // New state for report type
  const navigate = useNavigate();

  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        const rate = await getEthToKesRate();
        setEthToKesRate(rate);
      } catch (err) {
        console.error("Failed to fetch ETH/KES rate:", err);
        setError("Failed to fetch exchange rate. Using fallback rate.");
      }
    };
    fetchExchangeRate();
  }, []);

  useEffect(() => {
    if (walletError) {
      setError(walletError);
    }
  }, [walletError]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setError("No authentication token found. Redirecting to login...");
      setTimeout(() => navigate("/login"), 2000);
    }
  }, [navigate]);

  const fetchPendingRegistrations = async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/pending-registrations", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to fetch pending registrations");
      }

      const data = await response.json();
      setPendingRegistrations(data);
    } catch (err) {
      setError("Failed to fetch pending registrations: " + err.message);
      console.error("Fetch pending registrations error:", err);
    }
  };

  const handleConfirmRegistration = async (pendingId, walletAddress) => {
    if (!contract || !ethers.isAddress(walletAddress)) {
      setError("Cannot confirm registration: Invalid address or contract not set");
      return;
    }
    setIsConfirmingRegistration(true);
    setError("");
    try {
      console.log(`Registering user ${walletAddress} on blockchain`);
      const tx = await contract.registerUser(walletAddress);
      await tx.wait();
      console.log(`User ${walletAddress} registered on blockchain`);

      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/confirm-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pending_id: pendingId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to confirm registration in backend");
      }

      await fetchPendingRegistrations();
      await fetchAllUsersData();
      setError(`Successfully registered user ${walletAddress}`);
    } catch (err) {
      let errorMessage = "Failed to confirm registration";
      if (err.code === 4001) errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      else if (err.reason) errorMessage = `Contract error: ${err.reason}`;
      else errorMessage += `: ${err.message}`;
      setError(errorMessage);
      console.error("Confirm registration error:", err);
    } finally {
      setIsConfirmingRegistration(false);
    }
  };

  const handleRejectRegistration = async (pendingId, username) => {
    setIsRejectingRegistration(true);
    setError("");
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/reject-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pending_id: pendingId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to reject registration");
      }

      await fetchPendingRegistrations();
      await fetchAllUsersData();
      setError(`Successfully rejected user ${username}`);
    } catch (err) {
      setError("Failed to reject registration: " + err.message);
      console.error("Reject registration error:", err);
    } finally {
      setIsRejectingRegistration(false);
    }
  };

  const fetchAllUsersData = async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/users", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to fetch users' data");
      }

      const usersData = await response.json();
      if (usersData.length === 0) {
        setUsers([]);
        setFilteredUsers([]);
        setError("No users found in the system.");
        return;
      }

      if (contract) {
        const enrichedUsers = await Promise.all(
          usersData.map(async (user) => {
            if (user.wallet_address && ethers.isAddress(user.wallet_address)) {
              try {
                const isRegistered = await contract.isUserRegistered(user.wallet_address);
                if (!isRegistered) {
                  return {
                    ...user,
                    totalUsage: 0,
                    totalCostEth: 0,
                    totalCostKes: 0,
                    registrationStatus: "Not registered",
                  };
                }

                const [totalUsage, totalCostEth] = await contract.generateBillingReport(user.wallet_address);
                const totalCostEthNum = Number(ethers.formatEther(totalCostEth));
                return {
                  ...user,
                  totalUsage: Number(totalUsage),
                  totalCostEth: totalCostEthNum.toFixed(6),
                  totalCostKes: (totalCostEthNum * ethToKesRate).toFixed(2),
                  registrationStatus: "Registered",
                };
              } catch (err) {
                console.warn(`Error fetching billing report for ${user.username} (${user.wallet_address}):`, err);
                return {
                  ...user,
                  totalUsage: 0,
                  totalCostEth: 0,
                  totalCostKes: 0,
                  registrationStatus: "Error",
                };
              }
            }
            return {
              ...user,
              totalUsage: 0,
              totalCostEth: 0,
              totalCostKes: 0,
              registrationStatus: "No wallet",
            };
          })
        );
        setUsers(enrichedUsers);
        setFilteredUsers(enrichedUsers);
      } else {
        const defaultUsers = usersData.map((user) => ({
          ...user,
          totalUsage: 0,
          totalCostEth: 0,
          totalCostKes: 0,
          registrationStatus: "No contract",
        }));
        setUsers(defaultUsers);
        setFilteredUsers(defaultUsers);
        setError("Contract not initialized. Please connect your wallet.");
      }
    } catch (err) {
      setError("Failed to fetch users' data: " + err.message);
      setUsers([]);
      setFilteredUsers([]);
      console.error("Fetch users data error:", err);
    }
  };

  const fetchTotalDataUsageFromDB = async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/data-usage", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 403) {
          throw new Error("Access denied: User does not have the required role (wifi_provider).");
        }
        throw new Error(errorData.detail || "Failed to fetch total data usage from database");
      }

      const data = await response.json();
      setTotalUsageData(data);

      let cumulative = 0;
      const cumulativeData = data.map((entry) => {
        const total_usage_mb = Math.floor(Number(entry.total_usage_mb));
        let timestamp;
        try {
          timestamp = new Date(entry.timestamp);
          if (isNaN(timestamp.getTime())) {
            console.warn(`Invalid timestamp in entry: ${entry.timestamp}. Using current date.`);
            timestamp = new Date();
          }
        } catch (e) {
          console.warn(`Error parsing timestamp ${entry.timestamp}: ${e.message}. Using current date.`);
          timestamp = new Date();
        }
        cumulative += total_usage_mb;
        return { ...entry, total_usage_mb, cumulative_mb: cumulative, timestamp };
      });
      setCumulativeUsage(cumulativeData);
    } catch (err) {
      setError("Failed to fetch total data usage from database: " + err.message);
      console.error("Fetch total data usage error:", err);
    }
  };

  const fetchAllTransactions = async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/plan-purchases", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Failed to fetch transactions (HTTP ${response.status})`);
      }

      const transactions = await response.json();
      if (transactions.length === 0) {
        setError("No plan purchase transactions found.");
        setAllTransactions([]);
        return;
      }

      const formattedTransactions = transactions.map((tx, index) => ({
        id: index + 1,
        username: tx.username,
        userAddress: tx.user_address || "None",
        planName: tx.plan_name || "Unknown Plan",
        amountEth: Number(tx.amount_eth).toFixed(6),
        amountKes: Number(tx.amount_kes).toFixed(2),
        timestamp: new Date(tx.timestamp).toISOString().replace("T", " ").substring(0, 19),
        status: tx.status,
      }));

      setAllTransactions(formattedTransactions);
      setError("");
    } catch (err) {
      const errorMessage = `Failed to fetch transactions: ${err.message}`;
      setError(errorMessage);
      console.error("Fetch transactions error:", err);
      setAllTransactions([]);
    }
  };

  const fetchWifiPlans = async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/wifi-plans", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to fetch WiFi plans");
      }

      const data = await response.json();
      setWifiPlans(data.map((plan) => ({
        ...plan,
        price_eth: (plan.price_kes / ethToKesRate).toFixed(6),
      })));
    } catch (err) {
      setError("Failed to fetch WiFi plans: " + err.message);
      console.error("Fetch WiFi plans error:", err);
    }
  };

  const handleCreatePlan = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const data_mb = parseInt(newPlan.data_mb);
      const price_kes = parseFloat(newPlan.price_kes);
      if (isNaN(data_mb) || data_mb <= 0) throw new Error("Data amount must be a positive integer.");
      if (isNaN(price_kes) || price_kes <= 0) throw new Error("Price must be a positive number.");

      const response = await fetch("http://127.0.0.1:8000/isp/wifi-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newPlan.name, duration: newPlan.duration, price_kes, data_mb }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to create WiFi plan");
      }

      setNewPlan({ name: "", duration: "hourly", price_kes: "", data_mb: "" });
      await fetchWifiPlans();
      setError("WiFi plan created successfully!");
    } catch (err) {
      setError("Failed to create WiFi plan: " + err.message);
      console.error("Create WiFi plan error:", err);
    }
  };

  const handleEditPlan = async (e, planId) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const data_mb = parseInt(newPlan.data_mb);
      const price_kes = parseFloat(newPlan.price_kes);
      if (isNaN(data_mb) || data_mb <= 0) throw new Error("Data amount must be a positive integer.");
      if (isNaN(price_kes) || price_kes <= 0) throw new Error("Price must be a positive number.");

      const response = await fetch(`http://127.0.0.1:8000/isp/wifi-plans/${planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newPlan.name, duration: newPlan.duration, price_kes, data_mb }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to update WiFi plan");
      }

      setEditingPlan(null);
      setNewPlan({ name: "", duration: "hourly", price_kes: "", data_mb: "" });
      await fetchWifiPlans();
      setError("WiFi plan updated successfully!");
    } catch (err) {
      setError("Failed to update WiFi plan: " + err.message);
      console.error("Update WiFi plan error:", err);
    }
  };

  const handleDeletePlan = async (planId) => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch(`http://127.0.0.1:8000/isp/wifi-plans/${planId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to delete WiFi plan");
      }

      await fetchWifiPlans();
      setError("WiFi plan deleted successfully!");
    } catch (err) {
      setError("Failed to delete WiFi plan: " + err.message);
      console.error("Delete WiFi plan error:", err);
    }
  };

  const handleLogDataUsage = async (username, userAddress, usage_mb) => {
    if (!contract || !ethers.isAddress(userAddress)) {
      setError("Cannot log data usage: Invalid address or contract not set");
      return;
    }
    setIsLoggingData(true);
    setError("");
    try {
      const usage_mb_int = parseInt(usage_mb);
      if (isNaN(usage_mb_int) || usage_mb_int <= 0) throw new Error("Data usage must be a positive integer.");

      const tx = await contract.logDataUsageByISP(userAddress, usage_mb_int);
      await tx.wait();

      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/log-data-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username, usage_mb: usage_mb_int }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to log data usage to database");
      }

      await fetchAllUsersData();
      await fetchTotalDataUsageFromDB();
      setError(`Successfully logged ${usage_mb_int} MB for user ${username}`);
    } catch (err) {
      let errorMessage = "Failed to log data usage";
      if (err.code === 4001) errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      else if (err.reason) errorMessage = `Contract error: ${err.reason}`;
      else errorMessage += `: ${err.message}`;
      setError(errorMessage);
      console.error("Log data usage error:", err);
    } finally {
      setIsLoggingData(false);
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("username");
    await disconnectWallet();
    navigate("/");
  };

  const handleAdminRequests = () => {
    navigate("/isp/requests");
  };

  const filterDataByTimeRange = (data, type) => {
    const now = new Date();
    let startDate;

    switch (type) {
      case "daily":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "weekly":
        const day = now.getDay();
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day === 0 ? 6 : day - 1));
        break;
      case "monthly":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearly":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        return data;
    }

    return data.filter((entry) => {
      const entryDate = new Date(entry.timestamp);
      return entryDate >= startDate && entryDate <= now;
    });
  };

  const downloadLogsAsPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 10;
      let yOffset = 20;

      const reportTitle = `ISP ${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Logs`;
      doc.setFontSize(18);
      doc.text(reportTitle, pageWidth / 2, yOffset, { align: "center" });
      yOffset += 10;

      const filteredUsage = filterDataByTimeRange(cumulativeUsage, reportType);
      const filteredTransactions = filterDataByTimeRange(allTransactions, reportType);

      doc.setFontSize(14);
      doc.text(`${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Data Usage History`, margin, yOffset);
      yOffset += 10;

      if (filteredUsage.length > 0) {
        doc.setFontSize(10);
        const headers = ["Username", "Timestamp", "Daily Usage (MB)", "Cumulative Usage (MB)"];
        const rows = filteredUsage.map((entry) => [
          entry.username || "Unknown",
          new Date(entry.timestamp).toLocaleString(),
          entry.total_usage_mb,
          entry.cumulative_mb,
        ]);

        const colWidths = [50, 50, 30, 40];
        let xOffset = margin;

        headers.forEach((header, index) => {
          doc.text(header, xOffset, yOffset);
          xOffset += colWidths[index];
        });
        yOffset += 10;

        rows.forEach((row) => {
          xOffset = margin;
          row.forEach((cell, index) => {
            doc.text(String(cell), xOffset, yOffset);
            xOffset += colWidths[index];
          });
          yOffset += 8;
          if (yOffset > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage();
            yOffset = 20;
          }
        });
      } else {
        doc.setFontSize(10);
        doc.text(`No data usage history available for ${reportType} report.`, margin, yOffset);
        yOffset += 10;
      }

      yOffset += 10;
      if (yOffset > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        yOffset = 20;
      }

      doc.setFontSize(14);
      doc.text(`${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Transaction History`, margin, yOffset);
      yOffset += 10;

      if (filteredTransactions.length > 0) {
        doc.setFontSize(10);
        const headers = ["Username", "User Address", "Plan Name", "Amount (ETH)", "Amount (KES)", "Timestamp", "Status"];
        const rows = filteredTransactions.map((tx) => [
          tx.username,
          tx.userAddress,
          tx.planName,
          tx.amountEth,
          tx.amountKes,
          tx.timestamp,
          tx.status,
        ]);

        const colWidths = [30, 30, 30, 20, 20, 40, 20];
        let xOffset = margin;

        headers.forEach((header, index) => {
          doc.text(header, xOffset, yOffset);
          xOffset += colWidths[index];
        });
        yOffset += 10;

        rows.forEach((row) => {
          xOffset = margin;
          row.forEach((cell, index) => {
            doc.text(String(cell), xOffset, yOffset);
            xOffset += colWidths[index];
          });
          yOffset += 8;
          if (yOffset > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage();
            yOffset = 20;
          }
        });
      } else {
        doc.setFontSize(10);
        doc.text(`No transactions available for ${reportType} report.`, margin, yOffset);
        yOffset += 10;
      }

      const currentDate = new Date().toISOString().substring(0, 10);
      doc.save(`isp_${reportType}_logs_${currentDate}.pdf`);
    } catch (err) {
      setError("Failed to generate PDF: " + err.message);
      console.error("PDF generation error:", err);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    if (query === "") {
      setFilteredUsers(users);
      return;
    }
    const filtered = users.filter((user) => user.username.toLowerCase().includes(query));
    setFilteredUsers(filtered);
    if (filtered.length === 0) {
      setError(`No users found matching "${query}".`);
    } else {
      setError("");
    }
  };

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      await Promise.all([
        fetchAllUsersData(),
        fetchAllTransactions(),
        fetchTotalDataUsageFromDB(),
        fetchWifiPlans(),
        fetchPendingRegistrations(),
      ]);
    } catch (err) {
      setError("Failed to fetch dashboard data: " + err.message);
      console.error("Fetch all data error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setError("No authentication token found. Redirecting to login...");
      setTimeout(() => navigate("/login"), 2000);
      return;
    }

    if (isWalletConnected && contract && isISP) {
      fetchAllData();
      const interval = setInterval(() => {
        if (localStorage.getItem("access_token")) {
          fetchAllData();
        } else {
          setError("Authentication token lost. Redirecting to login...");
          clearInterval(interval);
          setTimeout(() => navigate("/login"), 2000);
        }
      }, 10000);
      return () => clearInterval(interval);
    } else if (!isISP && isWalletConnected) {
      setError("Connected wallet is not the ISP. Please connect the ISP wallet.");
    } else if (!isWalletConnected) {
      setError("Please connect your MetaMask wallet to access the ISP Dashboard.");
    }
  }, [isWalletConnected, contract, isISP, navigate]);

  const chartData = cumulativeUsage.map((entry) => ({
    timestamp: new Date(entry.timestamp).toISOString().substring(0, 10),
    total_usage_mb: entry.total_usage_mb,
    cumulative_mb: entry.cumulative_mb,
  }));

  const yAxisDomain =
    chartData.length > 0
      ? [
          Math.min(...chartData.map((d) => Math.min(d.total_usage_mb, d.cumulative_mb))) * 0.95,
          Math.max(...chartData.map((d) => Math.max(d.total_usage_mb, d.cumulative_mb))) * 1.05,
        ]
      : [0, 100];

  return (
    <>
      <div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-white">ISP Dashboard</h1>
          <div className="flex space-x-4">
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
                <button
                  onClick={handleAdminRequests}
                  className="bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300"
                >
                  Admin Requests
                </button>
              </>
            ) : (
              <button
                onClick={connectWallet}
                disabled={isConnecting}
                className={`bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300 ${
                  isConnecting ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {isConnecting ? "Connecting..." : "Connect MetaMask"}
              </button>
            )}
            <button
              onClick={handleLogout}
              className="bg-red-500 text-white py-2 px-4 rounded-full hover:bg-red-600 transition duration-300"
            >
              Logout
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
            <p>{error}</p>
            <button
              onClick={() => {
                setError("");
                setWalletError("");
              }}
              className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
            >
              Clear
            </button>
          </div>
        )}

        {isLoading && (
          <div className="mb-8 p-4 bg-blue-500 text-white rounded-lg shadow-lg">
            <p>Loading dashboard data...</p>
          </div>
        )}

        <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold text-white mb-4">Pending Registrations</h2>
          {pendingRegistrations.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Username</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Wallet Address</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Created At</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRegistrations.map((pending) => (
                    <tr key={pending.id} className="bg-gray-600">
                      <td className="border border-gray-600 p-3 text-white">{pending.username}</td>
                      <td className="border border-gray-600 p-3 text-white">{pending.wallet_address}</td>
                      <td className="border border-gray-600 p-3 text-white">{pending.created_at}</td>
                      <td className="border border-gray-600 p-3 text-white flex space-x-2">
                        <button
                          onClick={() => handleConfirmRegistration(pending.id, pending.wallet_address)}
                          disabled={isConfirmingRegistration || isRejectingRegistration}
                          className={`bg-green-500 text-white py-1 px-2 rounded-full hover:bg-green-600 transition duration-300 ${
                            isConfirmingRegistration || isRejectingRegistration ? "opacity-50 cursor-not-allowed" : ""
                          }`}
                        >
                          {isConfirmingRegistration ? "Confirming..." : "Confirm"}
                        </button>
                        <button
                          onClick={() => handleRejectRegistration(pending.id, pending.username)}
                          disabled={isConfirmingRegistration || isRejectingRegistration}
                          className={`bg-red-500 text-white py-1 px-2 rounded-full hover:bg-red-600 transition duration-300 ${
                            isConfirmingRegistration || isRejectingRegistration ? "opacity-50 cursor-not-allowed" : ""
                          }`}
                        >
                          {isRejectingRegistration ? "Rejecting..." : "Reject"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300">No pending registrations.</p>
          )}
        </div>

        <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold text-white">Users Overview</h2>
            <form onSubmit={handleSearch} className="flex space-x-2">
              <input
                type="text"
                placeholder="Search by username"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-gray-700 text-white p-2 rounded"
              />
              <button
                type="submit"
                className="bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300"
              >
                Search
              </button>
            </form>
          </div>
          {filteredUsers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Username</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Wallet Address</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Registration Status</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Total Usage (MB)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Total Cost (ETH)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Total Cost (KES)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Log Data Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="bg-gray-600">
                      <td className="border border-gray-600 p-3 text-white">{user.username}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.wallet_address || "None"}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.registrationStatus}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.totalUsage}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.totalCostEth}</td>
                      <td className="border border-gray-600 p-3 text-white">{user.totalCostKes}</td>
                      <td className="border border-gray-600 p-3 text-white">
                        {user.wallet_address && user.registrationStatus === "Registered" ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const usage = e.target.elements.usage_mb.value;
                              handleLogDataUsage(user.username, user.wallet_address, usage);
                              e.target.reset();
                            }}
                          >
                            <input
                              type="number"
                              name="usage_mb"
                              placeholder="MB"
                              className="bg-gray-700 text-white p-1 rounded mr-2 w-20"
                              required
                              min="1"
                            />
                            <button
                              type="submit"
                              disabled={isLoggingData}
                              className={`bg-blue-500 text-white py-1 px-2 rounded-full hover:bg-blue-600 transition duration-300 ${
                                isLoggingData ? "opacity-50 cursor-not-allowed" : ""
                              }`}
                            >
                              Log
                            </button>
                          </form>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300">No users found.</p>
          )}
        </div>

        <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold text-white">Total Data Usage History</h2>
            <div className="flex space-x-4 items-center">
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="bg-gray-700 text-white p-2 rounded"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              <button
                onClick={downloadLogsAsPDF}
                className="bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
              >
                Download Logs as PDF
              </button>
            </div>
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis dataKey="timestamp" stroke="#ccc" />
                <YAxis domain={yAxisDomain} stroke="#ccc" />
                <Tooltip contentStyle={{ backgroundColor: "#333", border: "none" }} />
                <Legend />
                <Line type="monotone" dataKey="total_usage_mb" stroke="#8884d8" name="Daily Usage (MB)" />
                <Line type="monotone" dataKey="cumulative_mb" stroke="#82ca9d" name="Cumulative Usage (MB)" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-300">No data usage history available.</p>
          )}
        </div>

        <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
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
              className="bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
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
          {wifiPlans.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Name</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Duration</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Price (KES)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Price (ETH)</th>
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
                      <td className="border border-gray-600 p-3 text-white">{plan.price_eth}</td>
                      <td className="border border-gray-600 p-3 text-white">{plan.data_mb}</td>
                      <td className="border border-gray-600 p-3 text-white">
                        <button
                          onClick={() => {
                            setEditingPlan(plan);
                            setNewPlan({
                              name: plan.name,
                              duration: plan.duration,
                              price_kes: plan.price_kes,
                              data_mb: plan.data_mb,
                            });
                          }}
                          className="bg-yellow-500 text-white py-1 px-2 rounded-full hover:bg-yellow-600 mr-2"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeletePlan(plan.id)}
                          className="bg-red-500 text-white py-1 px-2 rounded-full hover:bg-red-600"
                        >
                          Deactivate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300">No WiFi plans available.</p>
          )}
        </div>

        <div className="bg-gray-800 rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold text-white">Transaction History</h2>
            <div className="flex space-x-4 items-center">
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="bg-gray-700 text-white p-2 rounded"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              <button
                onClick={downloadLogsAsPDF}
                className="bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
              >
                Download Logs as PDF
              </button>
            </div>
          </div>
          {allTransactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Username</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">User Address</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Plan Name</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Amount (ETH)</th>
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
                      <td className="border border-gray-600 p-3 text-white">{tx.planName}</td>
                      <td className="border border-gray-600 p-3 text-white">{tx.amountEth}</td>
                      <td className="border border-gray-600 p-3 text-white">{tx.amountKes}</td>
                      <td className="border border-gray-600 p-3 text-white">{tx.timestamp}</td>
                      <td className="border border-gray-600 p-3 text-white">{tx.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300">No transactions available.</p>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
};

export default ISPDashboard;