import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import wiFiBillingArtifact from "../utils/WiFiBilling.json";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Extract the ABI from the artifact
const wiFiBillingABI = wiFiBillingArtifact.abi;

// Smart contract address
const CONTRACT_ADDRESS = "0xB4D58D26BDAd6c3f242bFe303eB0c020374920DE"; // Verify this matches your deployed contract
const GANACHE_RPC_URL = "http://127.0.0.1:7545"; // Adjust if Ganache uses a different port
const EXPECTED_CHAIN_ID = "0x539"; // Ganache chain ID (1337 in hex)
const GANACHE_NETWORK_NAME = "Ganache";

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
  const [isLoggingData, setIsLoggingData] = useState(false);
  const [isMintingTokens, setIsMintingTokens] = useState(false);
  const navigate = useNavigate();

  // Add or switch to Ganache network
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

  // Initialize ethers.js and check MetaMask connection
  useEffect(() => {
    const checkWalletConnection = async () => {
      if (!window.ethereum) {
        setError("MetaMask is not installed. Please install MetaMask and connect to Ganache.");
        return;
      }

      try {
        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        if (chainId !== EXPECTED_CHAIN_ID) {
          await addOrSwitchNetwork();
        }

        const provider = new ethers.BrowserProvider(window.ethereum);
        const code = await provider.getCode(CONTRACT_ADDRESS);
        if (code === "0x") {
          setError("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");
          return;
        }

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

          try {
            await updateWalletAddress(address);
            await fetchAllData();
          } catch (err) {
            setError(err.message);
            console.error("Failed to update wallet address during initialization:", err);
          }
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
            if (chainId !== EXPECTED_CHAIN_ID) {
              await addOrSwitchNetwork();
            }

            const provider = new ethers.BrowserProvider(window.ethereum);
            const code = await provider.getCode(CONTRACT_ADDRESS);
            if (code === "0x") {
              setError("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");
              return;
            }

            const signer = await provider.getSigner();
            const address = await signer.getAddress();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

            setSigner(signer);
            setIspAddress(ethers.getAddress(address));
            setContract(contract);
            setIsWalletConnected(true);
            setError("");
            console.log("Reconnected wallet:", address);

            try {
              await updateWalletAddress(address);
              await fetchAllData();
            } catch (err) {
              setError(err.message);
              console.error("Failed to update wallet address on account change:", err);
            }
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

            try {
              await updateWalletAddress(address);
              await fetchAllData();
            } catch (err) {
              setError(err.message);
              console.error("Failed to update wallet address after chain change:", err);
            }
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

  // Handle MetaMask wallet connection
  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("MetaMask is not installed. Please install MetaMask and connect to Ganache.");
      return;
    }

    setIsConnecting(true);
    setError("");
    try {
      await addOrSwitchNetwork();

      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned from MetaMask");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (chainId !== EXPECTED_CHAIN_ID) {
        throw new Error("Failed to connect to Ganache (chain ID 1337). Please try again.");
      }

      const code = await provider.getCode(CONTRACT_ADDRESS);
      if (code === "0x") {
        throw new Error("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

      setSigner(signer);
      setIspAddress(ethers.getAddress(address));
      setContract(contract);
      setIsWalletConnected(true);
      console.log("Wallet connected:", address);

      try {
        await updateWalletAddress(address);
        await fetchAllData();
      } catch (err) {
        setError(err.message);
        console.error("Wallet update failed:", err);
      }
    } catch (err) {
      let errorMessage = "Failed to connect wallet. Please try again.";
      if (err.code === 4001) {
        errorMessage = "Wallet connection rejected. Please connect your MetaMask wallet.";
      } else if (err.message.includes("already associated")) {
        errorMessage = err.message;
      } else {
        errorMessage += ` Error: ${err.message}`;
      }
      setError(errorMessage);
      console.error("Connect wallet error:", err);
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
        const errorData = await response.json();
        const errorMessage = errorData.detail || "Failed to update wallet address in backend";
        if (errorMessage.includes("Wallet address is already associated")) {
          throw new Error(
            "This wallet address is already associated with another user. Please select a different MetaMask account."
          );
        }
        if (response.status === 403) {
          localStorage.removeItem("token");
          localStorage.removeItem("username");
          navigate("/");
          throw new Error("Session expired or access denied. Please log in again.");
        }
        throw new Error(errorMessage);
      }
      console.log("Wallet address updated in backend:", walletAddress);
    } catch (err) {
      console.error("Update wallet address error:", err);
      throw err;
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
                console.log(`Fetching billing report for user: ${user.username}, address: ${user.wallet_address}`);
                let isRegistered = true;
                try {
                  if (contract.isUserRegistered) {
                    isRegistered = await contract.isUserRegistered(user.wallet_address);
                    console.log(`Is ${user.wallet_address} registered? ${isRegistered}`);
                  }
                } catch (err) {
                  console.warn(`isUserRegistered check failed for ${user.wallet_address}:`, err.message);
                }

                if (!isRegistered) {
                  console.warn(`User ${user.username} (${user.wallet_address}) not registered in contract`);
                  return {
                    ...user,
                    totalUsage: 0,
                    totalCost: 0,
                    tokenBalance: 0,
                    registrationStatus: "Not registered",
                  };
                }

                const [totalUsage, totalCost] = await contract.generateBillingReport(user.wallet_address);
                const tokenBalance = await contract.tokenBalances(user.wallet_address);
                return {
                  ...user,
                  totalUsage: Number(totalUsage) || 0,
                  totalCost: Number(totalCost) || 0,
                  tokenBalance: Number(tokenBalance) || 0,
                  registrationStatus: "Registered",
                };
              } catch (err) {
                let errorMessage = `Failed to fetch billing data for ${user.username}`;
                if (err.code === "BAD_DATA" && err.message.includes("could not decode result data")) {
                  errorMessage = `Unable to fetch billing data for ${user.username} (possible unregistered user or contract error)`;
                } else if (err.code === "CALL_EXCEPTION") {
                  errorMessage = `Contract call failed for ${user.username} (possible revert or user not registered)`;
                } else {
                  errorMessage += `: ${err.message}`;
                }
                setError(errorMessage);
                console.error(`Error fetching billing report for ${user.username} (${user.wallet_address}):`, err);
                return {
                  ...user,
                  totalUsage: 0,
                  totalCost: 0,
                  tokenBalance: 0,
                  registrationStatus: "Error",
                };
              }
            }
            console.log(`Skipping billing report for ${user.username}: No wallet address set`);
            return { ...user, totalUsage: 0, totalCost: 0, tokenBalance: 0, registrationStatus: "No wallet" };
          })
        );
        setUsers(enrichedUsers);
      } else {
        setUsers(usersData.map((user) => ({ ...user, totalUsage: 0, totalCost: 0, tokenBalance: 0, registrationStatus: "No contract" })));
      }
    } catch (err) {
      setError("Failed to fetch users' data: " + err.message);
      setUsers([]);
      console.error("Fetch users data error:", err);
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

  // Fetch all transactions from the blockchain for users with valid wallet addresses
  const fetchAllTransactions = async () => {
    if (!contract) {
      console.warn("Cannot fetch transactions: Contract not set");
      setAllTransactions([]);
      return;
    }

    // Filter users with valid wallet addresses
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
            if (!txs || txs.length === 0) {
              console.log(`No transactions found for user ${username} (${address})`);
              return [];
            }
            return txs.map((tx) => ({
              userAddress: address,
              username,
              id: Number(tx.id),
              amount: Number(tx.amount),
              timestamp: new Date(Number(tx.timestamp) * 1000).toISOString().replace("T", " ").substring(0, 19),
              status: tx.status,
            }));
          } catch (err) {
            console.warn(`Error fetching transactions for ${username} (${address}):`, err.message);
            return [];
          }
        })
      );
      const flattenedTxs = allTxs.flat();
      setAllTransactions(flattenedTxs);
      if (flattenedTxs.length === 0) {
        console.log("No transactions found for any users with valid wallet addresses");
      } else {
        console.log(`Fetched ${flattenedTxs.length} transactions for users`);
      }
    } catch (err) {
      setError("Failed to fetch transactions: " + err.message);
      setAllTransactions([]);
      console.error("Fetch transactions error:", err);
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
      console.error("Fetch WiFi plans error:", err);
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

      const data_mb = parseInt(newPlan.data_mb);
      if (isNaN(data_mb) || data_mb <= 0) {
        throw new Error("Invalid data amount. Please enter a positive integer.");
      }

      const price_kes = parseFloat(newPlan.price_kes);
      if (isNaN(price_kes) || price_kes <= 0) {
        throw new Error("Invalid price. Please enter a positive number.");
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
          price_kes,
          data_mb,
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
      console.error("Create WiFi plan error:", err);
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

      const data_mb = parseInt(newPlan.data_mb);
      if (isNaN(data_mb) || data_mb <= 0) {
        throw new Error("Invalid data amount. Please enter a positive integer.");
      }

      const price_kes = parseFloat(newPlan.price_kes);
      if (isNaN(price_kes) || price_kes <= 0) {
        throw new Error("Invalid price. Please enter a positive number.");
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
          price_kes,
          data_mb,
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
      console.error("Update WiFi plan error:", err);
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
      setError("Failed to fetch transactions: " + err.message);
      console.error("Delete WiFi plan error:", err);
    }
  };

  // Mint tokens for a specific user
  const handleMintTokens = async (userAddress, amount) => {
    if (!contract || !userAddress) {
      setError("Cannot mint tokens: Please connect your wallet and ensure user has a wallet address");
      return;
    }
    setIsMintingTokens(true);
    setError("");
    try {
      const amount_int = Math.floor(Number(amount));
      if (amount_int <= 0) {
        throw new Error("Invalid token amount. Please enter a positive integer.");
      }

      console.log(`Minting ${amount_int} tokens for user: ${userAddress}`);
      const tx = await contract.mintTokens(userAddress, amount_int);
      await tx.wait();
      await fetchAllUsersData();
      alert(`Successfully minted ${amount_int} WiFiTokens for user!`);
    } catch (err) {
      let errorMessage = "Failed to mint tokens";
      if (err.code === 4001) {
        errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      } else if (err.code === "INVALID_ARGUMENT" && err.message.includes("underflow")) {
        errorMessage = "Invalid token amount. Please ensure the amount is a whole number.";
      } else if (err.code === "CALL_EXCEPTION") {
        errorMessage = "Contract call failed (possible revert or user not registered)";
      } else {
        errorMessage += `: ${err.message}`;
      }
      setError(errorMessage);
      console.error(`Mint tokens error for ${userAddress}:`, err);
    } finally {
      setIsMintingTokens(false);
    }
  };

  // Log data usage for a specific user
  const handleLogDataUsage = async (username, userAddress, usage_mb) => {
    if (!contract || !userAddress) {
      setError("Cannot log data usage: Please connect your wallet and ensure user has a wallet address");
      return;
    }
    setIsLoggingData(true);
    setError("");
    try {
      const usage_mb_int = Math.floor(Number(usage_mb));
      if (usage_mb_int <= 0) {
        throw new Error("Invalid data usage value. Please enter a positive integer.");
      }

      console.log(`Logging data usage: ${usage_mb_int} MB for user: ${userAddress}`);
      const tx = await contract.logDataUsage(userAddress, usage_mb_int);
      await tx.wait();

      const token = localStorage.getItem("token");
      if (token) {
        const response = await fetch("http://127.0.0.1:8000/isp/log-data-usage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ username, usage_mb: usage_mb_int }),
        });
        if (!response.ok) {
          throw new Error("Failed to log data usage to database");
        }
      }

      await fetchAllUsersData();
      await fetchTotalDataUsageFromDB();
      alert(`Successfully logged ${usage_mb_int} MB for user ${username}!`);
    } catch (err) {
      let errorMessage = "Failed to log data usage";
      if (err.code === 4001) {
        errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      } else if (err.code === "INVALID_ARGUMENT" && err.message.includes("underflow")) {
        errorMessage = "Invalid data usage value. Please ensure usage is a whole number.";
      } else if (err.code === "CALL_EXCEPTION") {
        errorMessage = "Contract call failed (possible revert or user not registered)";
      } else {
        errorMessage += `: ${err.message}`;
      }
      setError(errorMessage);
      console.error(`Log data usage error for ${userAddress}:`, err);
    } finally {
      setIsLoggingData(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setIsWalletConnected(false);
    setIspAddress("");
    setContract(null);
    setSigner(null);
    setError("Logged out. Please reconnect your MetaMask wallet.");
    console.log("Logged out, wallet disconnected");

    if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
        console.log("MetaMask permissions revoked");
      } catch (err) {
        console.error("Failed to revoke MetaMask permissions:", err);
      }
    }
    navigate("/");
  };

  // Fetch all data
  const fetchAllData = async () => {
    await fetchAllUsersData();
    if (contract) {
      await fetchAllTransactions();
    }
    await fetchTotalDataUsageFromDB();
    await fetchWifiPlans();
  };

  // Fetch data on component mount and set up polling
  useEffect(() => {
    if (isWalletConnected && contract) {
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
  const yAxisDomain = chartData.length > 0
    ? [
        Math.min(...chartData.map((d) => Math.min(d.total_usage_mb, d.cumulative_mb))) * 0.95,
        Math.max(...chartData.map((d) => Math.max(d.total_usage_mb, d.cumulative_mb))) * 1.05,
      ]
    : [0, 100];

  return (
    <div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
      {/* Header with Connect Wallet, Update Wallet, and Logout Buttons */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">ISP Dashboard</h1>
        <div className="flex space-x-4">
          {isWalletConnected && ispAddress ? (
            <>
              <span className="text-white py-2 px-4">
                Connected: {ispAddress.slice(0, 6)}...{ispAddress.slice(-4)}
              </span>
              <button
                onClick={connectWallet}
                disabled={isConnecting}
                className={`bg-yellow-500 text-white py-2 px-4 rounded-full hover:bg-yellow-600 transition duration-300 ${
                  isConnecting ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {isConnecting ? "Updating..." : "Update Wallet"}
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

      {/* Error Message */}
      {error && (
        <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
          <p>{error}</p>
          {error.includes("Wallet address is already associated") && (
            <p className="mt-2">
              Click "Update Wallet" again and select a different MetaMask account that hasn’t been used by another user.
            </p>
          )}
          <button
            onClick={() => setError("")}
            className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
          >
            Clear Error
          </button>
        </div>
      )}

      {/* Dashboard Content */}
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
                step="1"
              />
            </div>
            <button
              type="submit"
              className="bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300"
              disabled={isLoggingData || isMintingTokens}
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
                disabled={isLoggingData || isMintingTokens}
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
                          disabled={isLoggingData || isMintingTokens}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeletePlan(plan.id)}
                          className="bg-red-500 text-white py-1 px-2 rounded-full hover:bg-red-600 transition duration-300"
                          disabled={isLoggingData || isMintingTokens}
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
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Status</th>
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
                      <td className="border border-gray-600 p-3 text-white">{user.registrationStatus}</td>
                      <td className="border border-gray-600 p-3 text-white">
                        <button
                          onClick={() => handleMintTokens(user.wallet_address, 1000)}
                          className="bg-yellow-500 text-white py-1 px-2 rounded-full hover:bg-yellow-600 transition duration-300 mr-2"
                          disabled={!user.wallet_address || isMintingTokens || isLoggingData}
                        >
                          {isMintingTokens ? "Minting..." : "Mint 1000 Tokens"}
                        </button>
                        <button
                          onClick={() => handleLogDataUsage(user.username, user.wallet_address, 50)}
                          className="bg-green-500 text-white py-1 px-2 rounded-full hover:bg-green-600 transition duration-300"
                          disabled={!user.wallet_address || isLoggingData || isMintingTokens}
                        >
                          {isLoggingData ? "Logging..." : "Log 50 MB"}
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
    </div>
  );
};

export default ISPDashboard;