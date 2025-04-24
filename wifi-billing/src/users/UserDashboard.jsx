import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import wiFiBillingArtifact from "../utils/WiFiBilling.json";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const wiFiBillingABI = wiFiBillingArtifact.abi;
const CONTRACT_ADDRESS = "0x609E600Ff6d549685b8E5B71d20616390A5B5e0D"; // Update with deployed contract address
const GANACHE_RPC_URL = "http://127.0.0.1:7545";
const EXPECTED_CHAIN_ID = "0x539"; // Ganache chain ID (1337 in hex)
const GANACHE_NETWORK_NAME = "Ganache";

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
  const [tokenBalance, setTokenBalance] = useState(0);
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSimulatingPayment, setIsSimulatingPayment] = useState(false);
  const [hasLoggedOut, setHasLoggedOut] = useState(false);
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
                nativeCurrency: {
                  name: "Ether",
                  symbol: "ETH",
                  decimals: 18,
                },
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

  // Validate and normalize address without ENS
  const normalizeAddress = async (address, provider) => {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }
    return ethers.getAddress(address); // This will checksum the address without ENS
  };

  // Connect wallet
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
      const normalizedAddress = await normalizeAddress(address, provider);
      const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

      await updateWalletAddress(normalizedAddress);

      // Check if user is registered
      let isRegistered = false;
      try {
        isRegistered = await contractInstance.isUserRegistered(normalizedAddress);
      } catch (err) {
        if (err.code === "CALL_EXCEPTION") {
          console.warn(`isUserRegistered reverted for ${normalizedAddress}: ${err.reason || "Assuming user not registered"}`);
        } else {
          throw err;
        }
      }

      if (!isRegistered) {
        throw new Error("User not registered on blockchain. Please contact your ISP to register your account.");
      }

      setSigner(signer);
      setUserAddress(normalizedAddress);
      setContract(contractInstance);
      setIsWalletConnected(true);
      setHasLoggedOut(false);
      console.log("Wallet connected:", normalizedAddress);

      await fetchAllData();
    } catch (err) {
      let errorMessage = "Failed to connect wallet. Please try again.";
      if (err.code === 4001) {
        errorMessage = "Wallet connection rejected. Please connect your MetaMask wallet.";
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else if (err.message.includes("update wallet address")) {
        errorMessage = err.message;
      } else if (err.message.includes("User not registered")) {
        errorMessage = err.message;
      } else {
        errorMessage += ` Error: ${err.message}`;
      }
      setError(errorMessage);
      setIsWalletConnected(false);
      setUserAddress("");
      setContract(null);
      setSigner(null);
      setTokenBalance(0);
      console.error("Connect wallet error:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  // Update wallet address in backend
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
        throw new Error(errorData.detail || "Failed to update wallet address in backend");
      }
      console.log("Wallet address updated in backend:", walletAddress);
    } catch (err) {
      throw new Error("Failed to update wallet address: " + err.message);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setIsWalletConnected(false);
    setUserAddress("");
    setContract(null);
    setSigner(null);
    setTokenBalance(0);
    setHasLoggedOut(true);
    setError("Logged out. Connect your MetaMask wallet to access blockchain features.");
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

  // Fetch token balance
  const fetchTokenBalance = async () => {
    if (!contract || !userAddress || !isWalletConnected) {
      console.warn("Cannot fetch token balance: Missing contract or user address");
      return;
    }
    try {
      console.log(`Fetching token balance for address: ${userAddress}`);
      const balance = await contract.tokenBalances(userAddress);
      const balanceNumber = Number(balance) || 0;
      setTokenBalance(balanceNumber);
      console.log(`Token balance for ${userAddress}: ${balanceNumber}`);
    } catch (err) {
      let errorMessage = "Failed to fetch token balance";
      if (err.code === "BAD_DATA" && err.message.includes("could not decode result data")) {
        errorMessage = "Unable to fetch token balance (possible contract error)";
      } else if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Possible user not registered"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setError(errorMessage);
      setTokenBalance(0);
      console.error(`Fetch token balance error for ${userAddress}:`, err);
    }
  };

  // Fetch data usage from database
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
      if (response.status === 403) {
        localStorage.removeItem("token");
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
      setError("Failed to fetch data usage from database: " + err.message);
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
      setError(errorMessage);
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
      setError(errorMessage);
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
      setError(errorMessage);
      setBillingReport({ total_usage_mb: 0, total_cost_kes: 0 });
      console.error(`Fetch billing report error for ${userAddress}:`, err);
    }
  };

  // Log data usage
  const handleLogDataUsage = async (usage_mb) => {
    try {
      const token = localStorage.getItem("token");
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
      setError(errorMessage);
      console.error(`Log data usage error for ${userAddress}:`, err);
    }
  };

  // Mint tokens
  const handleMintTokens = async (amount) => {
    if (!contract || !userAddress) {
      setError("Cannot mint tokens: Please connect your wallet");
      return;
    }
    try {
      const amount_int = Math.floor(Number(amount));
      if (amount_int <= 0) {
        throw new Error("Invalid token amount. Please enter a positive integer.");
      }

      console.log(`Minting ${amount_int} tokens for ${userAddress}`);
      const tx = await contract.mintTokens(userAddress, amount_int);
      await tx.wait();
      await fetchTokenBalance();
      alert(`Successfully minted ${amount_int} WiFiTokens!`);
    } catch (err) {
      let errorMessage = "Failed to mint tokens";
      if (err.code === 4001) {
        errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      } else if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Possible user not registered"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setError(errorMessage);
      console.error(`Mint tokens error for ${userAddress}:`, err);
    }
  };

  // Simulate payment
  const handleSimulatePayment = async () => {
    if (!contract || !userAddress || !isWalletConnected) {
      setError("Cannot simulate payment: Please connect your wallet");
      return;
    }
    setIsSimulatingPayment(true);
    setError("");
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

      const totalCost = totalUsageInt * costPerMB;
      console.log(`Simulate payment - totalUsage: ${totalUsageInt} MB, costPerMB: ${costPerMB}, totalCost: ${totalCost}`);

      const balance = Number(await contract.tokenBalances(userAddress));
      if (isNaN(balance)) {
        throw new Error("Invalid token balance from contract. Please try again.");
      }

      if (balance < totalCost) {
        const amountToMint = Math.ceil(totalCost - balance + 100);
        console.log(`Insufficient balance (${balance} < ${totalCost}). Minting ${amountToMint} tokens`);
        await handleMintTokens(amountToMint);
      }

      console.log(`Calling makePayment with: ${totalUsageInt}`);
      const tx = await contract.makePayment(totalUsageInt);
      await tx.wait();

      await fetchDataUsageFromDB();
      await fetchTransactions();
      await fetchBillingReport();
      await fetchTokenBalance();

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
      setError(errorMessage);
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
        setError("User not registered on blockchain. Please contact your ISP to register your account.");
        return;
      }

      await fetchTransactions();
      await fetchBillingReport();
      await fetchTokenBalance();
    } catch (err) {
      let errorMessage = "Failed to fetch blockchain data";
      if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Possible user not registered or contract issue"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setError(errorMessage);
      console.error(`Fetch all data error for ${userAddress}:`, err);
    }
  };

  // Initialize MetaMask and check for existing connection
  useEffect(() => {
    const initialize = async () => {
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
          const normalizedAddress = await normalizeAddress(address, provider);
          const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

          // Check if user is registered
          let isRegistered = false;
          try {
            isRegistered = await contractInstance.isUserRegistered(normalizedAddress);
          } catch (err) {
            if (err.code === "CALL_EXCEPTION") {
              console.warn(`User ${normalizedAddress} not registered`);
            } else {
              throw err;
            }
          }

          if (!isRegistered) {
            setError("User not registered on blockchain. Please contact your ISP to register your account.");
            return;
          }

          setSigner(signer);
          setUserAddress(normalizedAddress);
          setContract(contractInstance);
          setIsWalletConnected(true);
          setError("");
          console.log("Restored wallet connection:", normalizedAddress);

          await updateWalletAddress(normalizedAddress);
          await fetchAllData();
        } else {
          setError("Please connect your MetaMask wallet to access blockchain features.");
        }
      } catch (err) {
        setError("Failed to restore wallet connection: " + err.message);
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
            const address = accounts[0];
            const normalizedAddress = await normalizeAddress(address, provider);
            const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

            // Check if user is registered
            let isRegistered = false;
            try {
              isRegistered = await contractInstance.isUserRegistered(normalizedAddress);
            } catch (err) {
              if (err.code === "CALL_EXCEPTION") {
                console.warn(`User ${normalizedAddress} not registered`);
              } else {
                throw err;
              }
            }

            if (!isRegistered) {
              setError("User not registered on blockchain. Please contact your ISP to register your account.");
              return;
            }

            setSigner(signer);
            setUserAddress(normalizedAddress);
            setContract(contractInstance);
            setIsWalletConnected(true);
            setError("");
            console.log("Reconnected wallet:", normalizedAddress);

            await updateWalletAddress(normalizedAddress);
            await fetchAllData();
          } catch (err) {
            setError("Failed to reconnect wallet: " + err.message);
            console.error("Accounts changed error:", err);
            if (userAddress && contract && signer) {
              console.log("Preserving existing wallet connection due to error");
            } else {
              setIsWalletConnected(false);
              setUserAddress("");
              setContract(null);
              setSigner(null);
              setTokenBalance(0);
            }
          }
        } else {
          setIsWalletConnected(false);
          setUserAddress("");
          setContract(null);
          setSigner(null);
          setTokenBalance(0);
          setError("Wallet disconnected. Please reconnect your MetaMask wallet.");
          console.log("Wallet disconnected");
        }
      });

      window.ethereum.on("chainChanged", async (chainId) => {
        if (chainId !== EXPECTED_CHAIN_ID) {
          setError("Network changed. Please reconnect to Ganache (chain ID 1337).");
          setIsWalletConnected(false);
          setUserAddress("");
          setContract(null);
          setSigner(null);
          setTokenBalance(0);
          try {
            await addOrSwitchNetwork();
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const address = await signer.getAddress();
            const normalizedAddress = await normalizeAddress(address, provider);
            const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

            // Check if user is registered
            let isRegistered = false;
            try {
              isRegistered = await contractInstance.isUserRegistered(normalizedAddress);
            } catch (err) {
              if (err.code === "CALL_EXCEPTION") {
                console.warn(`User ${normalizedAddress} not registered`);
              } else {
                throw err;
              }
            }

            if (!isRegistered) {
              setError("User not registered on blockchain. Please contact your ISP to register your account.");
              return;
            }

            setSigner(signer);
            setUserAddress(normalizedAddress);
            setContract(contractInstance);
            setIsWalletConnected(true);
            setError("");
            console.log("Reconnected after chain change:", normalizedAddress);

            await updateWalletAddress(normalizedAddress);
            await fetchAllData();
          } catch (err) {
            setError("Failed to reconnect to Ganache after network change: " + err.message);
            console.error("Chain changed error:", err);
          }
        }
      });
    };

    initialize();

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener("accountsChanged", () => {});
        window.ethereum.removeListener("chainChanged", () => {});
      }
    };
  }, [navigate]);

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
    <div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">User Dashboard</h1>
        <div className="flex space-x-4 items-center">
          {isWalletConnected && userAddress && (
            <span className="text-white py-2 px-4">
              Connected: {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
            </span>
          )}
          <button
            onClick={connectWallet}
            disabled={isConnecting}
            className={`bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300 ${
              isConnecting ? "opacity-50 cursor-not-allowed" : ""
            }`}
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
      {error && (
        <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
          <p>{error}</p>
          <button
            onClick={() => setError("")}
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
              disabled={isConnecting}
              className={`bg-blue-500 text-white py-2 px-6 rounded-full hover:bg-blue-600 transition duration-300 ${
                isConnecting ? "opacity-50 cursor-not-allowed" : ""
              }`}
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
            <div className="mb-4">
              <button
                onClick={() => handleLogDataUsage(50)}
                className="bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
                disabled={isSimulatingPayment || !isWalletConnected}
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
                      labelStyle={{ color: "#fff" }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="usage_mb"
                      stroke="#8884d8"
                      strokeWidth={3}
                      activeDot={{ r: 8 }}
                      name="Usage (MB)"
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

          {/* Simulate Payment Card */}
          <div className="bg-gray-800 rounded-lg shadow-lg p-6 h-96 flex flex-col">
            <h2 className="text-2xl font-semibold text-white mb-4">Simulate Payment</h2>
            <div className="text-gray-300 flex-1">
              <p className="mb-4">
                You have used {totalUsage} MB. Simulate a payment to continue accessing WiFi.
              </p>
              <button
                onClick={() => handleMintTokens(1000)}
                className="bg-yellow-500 text-white py-2 px-4 rounded-full hover:bg-yellow-600 transition duration-300 mb-4"
                disabled={isSimulatingPayment || !isWalletConnected}
              >
                Mint 1000 WiFiTokens (Test)
              </button>
              <button
                onClick={handleSimulatePayment}
                className="bg-blue-500 text-white py-3 px-6 rounded-full hover:bg-blue-600 transition duration-300"
                disabled={totalUsage === 0 || !isWalletConnected || isSimulatingPayment}
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
    </div>
  );
};

export default UserDashboard;