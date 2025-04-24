import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import wiFiBillingArtifact from "../utils/WiFiBilling.json";
import { getEthToKesRate } from "../utils/exchangeRate";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const wiFiBillingABI = wiFiBillingArtifact.abi;
const CONTRACT_ADDRESS = "0x609E600Ff6d549685b8E5B71d20616390A5B5e0D"; // Update to new contract address
const GANACHE_RPC_URL = "http://127.0.0.1:7545";
const EXPECTED_CHAIN_ID = "0x539"; // Ganache chain ID (1337 in hex)
const GANACHE_NETWORK_NAME = "Ganache";

const ISPDashboard = () => {
  const [users, setUsers] = useState([]);
  const [pendingRegistrations, setPendingRegistrations] = useState([]);
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
  const [isLoggingData, setIsLoggingData] = useState(false);
  const [isConfirmingRegistration, setIsConfirmingRegistration] = useState(false);
  const [ethToKesRate, setEthToKesRate] = useState(247789.20); // Fallback rate
  const navigate = useNavigate();

  // Fetch обменный курс на момент загрузки
  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        const rate = await getEthToKesRate();
        setEthToKesRate(rate);
      } catch (err) {
        console.error("Failed to fetch ETH/KES rate:", err);
      }
    };
    fetchExchangeRate();
  }, []);

  // Добавить или переключиться на сеть Ganache
  const addOrSwitchNetwork = async () => {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: EXPECTED_CHAIN_ID }],
      });
      console.log("Switched to Ganache network");
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: EXPECTED_CHAIN_ID,
                chainName: GANACHE_NETWORK_NAME,
                rpcUrls: [GANACHE_RPC_URL],
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                blockExplorerUrls: null,
              },
            ],
          });
          console.log("Added Ganache network");
        } catch (addError) {
          throw new Error(`Failed to add Ganache network: ${addError.message}`);
        }
      } else {
        throw new Error(`Failed to switch to Ganache network: ${switchError.message}`);
      }
    }
  };

  // Инициализация ethers.js и проверка подключения MetaMask
  useEffect(() => {
    const checkWalletConnection = async () => {
      if (!window.ethereum) {
        setError("MetaMask is not installed. Please install MetaMask and connect to Ganache.");
        return;
      }

      try {
        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        if (chainId !== EXPECTED_CHAIN_ID) await addOrSwitchNetwork();

        const staticProvider = new ethers.JsonRpcProvider(GANACHE_RPC_URL);
        const code = await staticProvider.getCode(CONTRACT_ADDRESS);
        if (code === "0x") {
          setError("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");
          return;
        }

        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts.length > 0) {
          const signer = await provider.getSigner();
          const address = await signer.getAddress();
          const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

          setSigner(signer);
          setIspAddress(ethers.getAddress(address));
          setContract(contract);
          setIsWalletConnected(true);
          setError("");
          console.log("Restored wallet connection:", address);

          await updateWalletAddress(address);
          await fetchAllData();
        } else {
          setError("Please connect your MetaMask wallet to access ISP dashboard.");
        }
      } catch (err) {
        setError("Failed to initialize blockchain connection: " + err.message);
        console.error("Initialize error:", err);
      }

      window.ethereum.on("accountsChanged", async (accounts) => {
        if (accounts.length > 0) {
          try {
            const chainId = await window.ethereum.request({ method: "eth_chainId" });
            if (chainId !== EXPECTED_CHAIN_ID) await addOrSwitchNetwork();

            const staticProvider = new ethers.JsonRpcProvider(GANACHE_RPC_URL);
            const code = await staticProvider.getCode(CONTRACT_ADDRESS);
            if (code === "0x") {
              setError("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");
              return;
            }

            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const address = await signer.getAddress();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

            setSigner(signer);
            setIspAddress(ethers.getAddress(address));
            setContract(contract);
            setIsWalletConnected(true);
            setError("");
            console.log("Reconnected wallet:", address);

            await updateWalletAddress(address);
            await fetchAllData();
          } catch (err) {
            setError("Failed to reconnect wallet: " + err.message);
            console.error("Accounts changed error:", err);
          }
        } else {
          setIsWalletConnected(false);
          setIspAddress("");
          setContract(null);
          setSigner(null);
          setError("Wallet disconnected. Please reconnect your MetaMask wallet.");
          console.log("Wallet disconnected");
        }
      });

      window.ethereum.on("chainChanged", async (chainId) => {
        if (chainId !== EXPECTED_CHAIN_ID) {
          setError("Network changed. Please reconnect to Ganache (chain ID 1337).");
          setIsWalletConnected(false);
          setIspAddress("");
          setContract(null);
          setSigner(null);
          try {
            await addOrSwitchNetwork();
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const address = await signer.getAddress();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

            setSigner(signer);
            setIspAddress(ethers.getAddress(address));
            setContract(contract);
            setIsWalletConnected(true);
            setError("");
            console.log("Reconnected after chain change:", address);

            await updateWalletAddress(address);
            await fetchAllData();
          } catch (err) {
            setError("Failed to reconnect to Ganache after network change: " + err.message);
            console.error("Chain changed error:", err);
          }
        }
      });

      return () => {
        if (window.ethereum) {
          window.ethereum.removeListener("accountsChanged", () => {});
          window.ethereum.removeListener("chainChanged", () => {});
        }
      };
    };
    checkWalletConnection();
  }, []);

  // Подключение кошелька
  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("MetaMask is not installed. Please install MetaMask and connect to Ganache.");
      return;
    }

    setIsConnecting(true);
    setError("");
    try {
      await addOrSwitchNetwork();
      await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts || accounts.length === 0) throw new Error("No accounts returned from MetaMask");

      const provider = new ethers.BrowserProvider(window.ethereum);
      const staticProvider = new ethers.JsonRpcProvider(GANACHE_RPC_URL);
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (chainId !== EXPECTED_CHAIN_ID) throw new Error("Failed to connect to Ganache (chain ID 1337). Please try again.");

      const code = await staticProvider.getCode(CONTRACT_ADDRESS);
      if (code === "0x") throw new Error("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

      setSigner(signer);
      setIspAddress(ethers.getAddress(address));
      setContract(contract);
      setIsWalletConnected(true);
      console.log("Wallet connected:", address);

      await updateWalletAddress(address);
      await fetchAllData();
    } catch (err) {
      let errorMessage = "Failed to connect wallet. Please try again.";
      if (err.code === 4001) errorMessage = "Wallet connection rejected. Please connect your MetaMask wallet.";
      else if (err.code === -32603) errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      else errorMessage += ` Error: ${err.message}`;
      setError(errorMessage);
      setIsWalletConnected(false);
      setIspAddress("");
      setContract(null);
      setSigner(null);
      console.error("Connect wallet error:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  // Обновление адреса кошелька в бэкенде
  const updateWalletAddress = async (walletAddress) => {
    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/update-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet_address: walletAddress }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to update wallet address in backend");
      }
      console.log("Wallet address updated in backend:", walletAddress);
    } catch (err) {
      setError("Failed to update wallet address: " + err.message);
      console.error("Update wallet address error:", err);
    }
  };

  // Получение ожидающих регистраций
  const fetchPendingRegistrations = async () => {
    try {
      const token = localStorage.getItem("token");
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

  // Подтверждение регистрации
  const handleConfirmRegistration = async (pendingId, walletAddress) => {
    if (!contract || !ethers.isAddress(walletAddress)) {
      setError("Cannot confirm registration: Invalid address or contract not set");
      return;
    }
    setIsConfirmingRegistration(true);
    setError("");
    try {
      // Регистрация в блокчейне
      console.log(`Registering user ${walletAddress} on blockchain`);
      const tx = await contract.registerUser(walletAddress);
      await tx.wait();
      console.log(`User ${walletAddress} registered on blockchain`);

      // Подтверждение в бэкенде
      const token = localStorage.getItem("token");
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

  // Получение данных всех пользователей
  const fetchAllUsersData = async () => {
    try {
      const token = localStorage.getItem("token");
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
      } else {
        setUsers(usersData.map((user) => ({ ...user, totalUsage: 0, totalCostEth: 0, totalCostKes: 0, registrationStatus: "No contract" })));
      }
    } catch (err) {
      setError("Failed to fetch users' data: " + err.message);
      setUsers([]);
      console.error("Fetch users data error:", err);
    }
  };

  // Получение общего использования данных из базы данных
  const fetchTotalDataUsageFromDB = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/isp/data-usage", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to fetch total data usage from database");
      }

      const data = await response.json();
      setTotalUsageData(data);

      let cumulative = 0;
      const cumulativeData = data.map((entry) => {
        const total_usage_mb = Math.floor(Number(entry.total_usage_mb));
        cumulative += total_usage_mb;
        return { ...entry, total_usage_mb, cumulative_mb: cumulative };
      });
      setCumulativeUsage(cumulativeData);
    } catch (err) {
      setError("Failed to fetch total data usage from database: " + err.message);
      console.error("Fetch total data usage error:", err);
    }
  };

  // Получение всех транзакций
  const fetchAllTransactions = async () => {
    if (!contract) {
      console.warn("Cannot fetch transactions: Contract not set");
      setAllTransactions([]);
      return;
    }

    const userAddresses = users
      .filter((user) => user.wallet_address && ethers.isAddress(user.wallet_address))
      .map((user) => ({ address: user.wallet_address, username: user.username }));

    if (!userAddresses.length) {
      console.log("No users with valid wallet addresses to fetch transactions");
      setAllTransactions([]);
      return;
    }

    try {
      const allTxs = await Promise.all(
        userAddresses.map(async ({ address, username }) => {
          try {
            const txs = await contract.getTransactions(address);
            return txs.map((tx) => {
              const amountEth = Number(ethers.formatEther(tx.amount));
              return {
                userAddress: address,
                username,
                id: Number(tx.id),
                amountEth: amountEth.toFixed(6),
                amountKes: (amountEth * ethToKesRate).toFixed(2),
                timestamp: new Date(Number(tx.timestamp) * 1000).toISOString().replace("T", " ").substring(0, 19),
                status: tx.status,
              };
            });
          } catch (err) {
            console.warn(`Error fetching transactions for ${username} (${address}):`, err);
            return [];
          }
        })
      );
      const flattenedTxs = allTxs.flat();
      setAllTransactions(flattenedTxs);
    } catch (err) {
      setError("Failed to fetch transactions: " + err.message);
      console.error("Fetch transactions error:", err);
    }
  };

  // Получение WiFi-планов из бэкенда
  const fetchWifiPlans = async () => {
    try {
      const token = localStorage.getItem("token");
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

  // Создание WiFi-плана
  const handleCreatePlan = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");
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

  // Редактирование WiFi-плана
  const handleEditPlan = async (e, planId) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");
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

  // Удаление WiFi-плана
  const handleDeletePlan = async (planId) => {
    try {
      const token = localStorage.getItem("token");
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

  // Логирование использования данных
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

      const token = localStorage.getItem("token");
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

  // Обработка выхода
  const handleLogout = async () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setIsWalletConnected(false);
    setIspAddress("");
    setContract(null);
    setSigner(null);
    setError("Logged out. Please log in again.");
    console.log("Logged out, wallet disconnected");

    if (window.ethereum) {
      try {
        await window.ethereum.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
        console.log("MetaMask permissions revoked");
      } catch (err) {
        console.error("Failed to revoke MetaMask permissions:", err);
      }
    }
    navigate("/");
  };

  // Получение всех данных
  const fetchAllData = async () => {
    await fetchAllUsersData();
    await fetchAllTransactions();
    await fetchTotalDataUsageFromDB();
    await fetchWifiPlans();
    await fetchPendingRegistrations();
  };

  // Получение данных при подключении кошелька
  useEffect(() => {
    if (isWalletConnected && contract) {
      fetchAllData();
      const interval = setInterval(fetchAllData, 10000); // Обновление каждые 10 секунд
      return () => clearInterval(interval);
    }
  }, [isWalletConnected, contract]);

  // Данные для графика
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
    <div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
      {/* Заголовок */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">ISP Dashboard</h1>
        <div className="flex space-x-4">
          {isWalletConnected && ispAddress ? (
            <span className="text-white py-2 px-4">
              Connected: {ispAddress.slice(0, 6)}...{ispAddress.slice(-4)}
            </span>
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

      {/* Сообщение об ошибке */}
      {error && (
        <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
          <p>{error}</p>
          <button
            onClick={() => setError("")}
            className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
          >
            Clear
          </button>
        </div>
      )}

      {/* Ожидающие регистрации */}
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
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingRegistrations.map((pending) => (
                  <tr key={pending.id} className="bg-gray-600">
                    <td className="border border-gray-600 p-3 text-white">{pending.username}</td>
                    <td className="border border-gray-600 p-3 text-white">{pending.wallet_address}</td>
                    <td className="border border-gray-600 p-3 text-white">{pending.created_at}</td>
                    <td className="border border-gray-600 p-3 text-white">
                      <button
                        onClick={() => handleConfirmRegistration(pending.id, pending.wallet_address)}
                        disabled={isConfirmingRegistration}
                        className={`bg-green-500 text-white py-1 px-2 rounded-full hover:bg-green-600 transition duration-300 ${
                          isConfirmingRegistration ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        {isConfirmingRegistration ? "Confirming..." : "Confirm"}
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

      {/* Обзор пользователей */}
      <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
        <h2 className="text-2xl font-semibold text-white mb-4">Users Overview</h2>
        {users.length > 0 ? (
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
                {users.map((user) => (
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

      {/* История использования данных */}
      <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
        <h2 className="text-2xl font-semibold text-white mb-4">Total Data Usage History</h2>
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

      {/* Управление WiFi-планами */}
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
                        Delete
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

      {/* История транзакций */}
      <div className="bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-semibold text-white mb-4">Transaction History</h2>
        {allTransactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-gray-600">
              <thead>
                <tr className="bg-gray-700">
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Username</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">User Address</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Transaction ID</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Amount (ETH)</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Amount (KES)</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Timestamp</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Status</th>
                </tr>
              </thead>
              <tbody>
                {allTransactions.map((tx, index) => (
                  <tr key={`${tx.userAddress}-${tx.id}-${index}`} className="bg-gray-600">
                    <td className="border border-gray-600 p-3 text-white">{tx.username}</td>
                    <td className="border border-gray-600 p-3 text-white">{tx.userAddress}</td>
                    <td className="border border-gray-600 p-3 text-white">{tx.id}</td>
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
  );
};

export default ISPDashboard;