import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import wiFiBillingArtifact from "../utils/WiFiBilling.json";

const wiFiBillingABI = wiFiBillingArtifact.abi;
const CONTRACT_ADDRESS = "0x83d14bB2192e6040841b148f96A3B85ded6A2C94"; // Verify this matches deployed contract
const GANACHE_RPC_URL = "http://127.0.0.1:7545";
const EXPECTED_CHAIN_ID = "0x539"; // Ganache chain ID (1337 in hex)
const GANACHE_NETWORK_NAME = "Ganache";

// Validate CONTRACT_ADDRESS at startup
if (!ethers.isAddress(CONTRACT_ADDRESS)) {
  console.error("Invalid CONTRACT_ADDRESS:", CONTRACT_ADDRESS);
  throw new Error("CONTRACT_ADDRESS is not a valid Ethereum address");
}

const WiFiPlans = () => {
  const [wifiPlans, setWifiPlans] = useState([]);
  const [purchasedPlans, setPurchasedPlans] = useState([]);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [error, setError] = useState("");
  const [contract, setContract] = useState(null);
  const [signer, setSigner] = useState(null);
  const [userAddress, setUserAddress] = useState("");
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
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
  const normalizeAddress = (address) => {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }
    return ethers.getAddress(address); // Checksum without ENS
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
      const staticProvider = new ethers.JsonRpcProvider(GANACHE_RPC_URL);
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (chainId !== EXPECTED_CHAIN_ID) {
        throw new Error("Failed to connect to Ganache (chain ID 1337). Please try again.");
      }

      const code = await staticProvider.getCode(CONTRACT_ADDRESS);
      if (code === "0x") {
        throw new Error("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const normalizedAddress = normalizeAddress(address);
      const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

      setSigner(signer);
      setUserAddress(normalizedAddress);
      setContract(contractInstance);
      setIsWalletConnected(true);
      console.log("Wallet connected:", normalizedAddress);

      await updateWalletAddress(normalizedAddress);
      await fetchTokenBalance();
      await fetchPurchasedPlans();
    } catch (err) {
      let errorMessage = "Failed to connect wallet. Please try again.";
      if (err.code === 4001) {
        errorMessage = "Wallet connection rejected. Please connect your MetaMask wallet.";
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
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

  // Fetch WiFi plans
  const fetchWifiPlans = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      console.log("Fetching WiFi plans from backend");
      const response = await fetch("http://127.0.0.1:8000/wifi-plans", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        navigate("/");
        throw new Error("Session expired. Please log in again.");
      }
      if (response.status === 403) {
        navigate("/dashboard");
        throw new Error("Access denied. ISP role required.");
      }
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to fetch WiFi plans");
      }

      const backendPlans = await response.json();

      // If contract is available, cross-check with active plans
      let validPlans = backendPlans;
      if (contract && isWalletConnected) {
        console.log("Cross-checking plans with contract");
        try {
          const activePlans = await contract.getActivePlans();
          const activePlanIds = activePlans.map((plan) => Number(plan.id));
          validPlans = backendPlans.filter((plan) => activePlanIds.includes(plan.id));
          console.log("Valid plans after cross-check:", validPlans);
        } catch (contractError) {
          console.warn("Failed to fetch active plans from contract:", contractError);
          setError("Warning: Could not verify plans with contract. Displaying backend plans.");
        }
      }

      setWifiPlans(validPlans);
      console.log("Fetched WiFi plans:", validPlans);
    } catch (err) {
      setError(`Failed to fetch WiFi plans: ${err.message}`);
      console.error("Fetch WiFi plans error:", err);
    }
  };

  // Fetch purchased plans
  const fetchPurchasedPlans = async () => {
    if (!contract || !userAddress || !isWalletConnected) {
      console.warn("Cannot fetch purchased plans: Missing contract or user address");
      return;
    }
    try {
      console.log(`Fetching purchased plans for address: ${userAddress}`);
      const plans = await contract.getPurchasedPlans(userAddress);
      const formattedPlans = plans.map((plan) => ({
        id: Number(plan.id),
        name: plan.name,
        duration: plan.duration,
        priceKes: Number(plan.priceKes),
        dataMb: Number(plan.dataMb),
        purchaseDate: new Date(Number(plan.purchaseDate) * 1000).toISOString().replace("T", " ").substring(0, 19),
      }));
      setPurchasedPlans(formattedPlans);
      console.log(`Purchased plans for ${userAddress}:`, formattedPlans);
    } catch (err) {
      let errorMessage = "Failed to fetch purchased plans";
      if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Possible user not registered"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else {
        errorMessage += `: ${err.message}`;
      }
      setError(errorMessage);
      console.error(`Fetch purchased plans error for ${userAddress}:`, err);
    }
  };

  // Purchase plan
  const handlePurchasePlan = async (planId) => {
    if (!contract || !userAddress || !isWalletConnected) {
      setError("Cannot purchase plan: Please connect your wallet");
      return;
    }
    if (!Number.isInteger(planId) || planId <= 0) {
      setError("Invalid plan ID. Please select a valid plan.");
      return;
    }

    setIsPurchasing(true);
    setError("");
    try {
      console.log(`Purchasing plan ID ${planId} for ${userAddress}`);

      // Validate plan existence
      try {
        const plan = await contract.wifiPlans(planId);
        const isActive = plan.active;
        const planIdFromContract = Number(plan.id);
        if (planIdFromContract === 0 || !isActive) {
          throw new Error("Plan does not exist or is inactive");
        }
        console.log(`Plan ${planId} details:`, plan);
      } catch (planError) {
        throw new Error(`Failed to validate plan: ${planError.message}`);
      }

      // Check token balance
      const balance = await contract.tokenBalances(userAddress);
      const balanceNumber = Number(balance);
      if (balanceNumber === 0) {
        throw new Error("Insufficient WiFiTokens to purchase this plan.");
      }
      console.log(`User balance: ${balanceNumber} WiFiTokens`);

      // Attempt purchase
      const tx = await contract.purchasePlan(planId, { gasLimit: 300000 });
      await tx.wait();

      await fetchTokenBalance();
      await fetchPurchasedPlans();
      alert(`Successfully purchased plan ID ${planId}!`);
    } catch (err) {
      let errorMessage = "Failed to purchase plan";
      if (err.code === 4001) {
        errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      } else if (err.code === "CALL_EXCEPTION") {
        errorMessage = `Contract call failed: ${err.reason || "Check plan ID, balance, or contract state"}`;
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      } else if (err.message.includes("Plan does not exist")) {
        errorMessage = "Selected plan is not available. Please choose another plan or contact support.";
      } else if (err.message.includes("Insufficient WiFiTokens")) {
        errorMessage = "You do not have enough WiFiTokens to purchase this plan.";
      } else if (err.message.includes("contract.wifiPlans is not a function")) {
        errorMessage = "Contract interaction failed. Please check contract deployment or ABI.";
      } else {
        errorMessage += `: ${err.message}`;
      }
      setError(errorMessage);
      console.error(`Purchase plan error for ${userAddress}:`, err);
    } finally {
      setIsPurchasing(false);
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
    setError("Logged out. Please log in again.");
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

  // Initialize MetaMask and fetch plans
  useEffect(() => {
    const initialize = async () => {
      // Check authentication
      const token = localStorage.getItem("token");
      if (!token) {
        setError("Please log in to access WiFi plans.");
        navigate("/");
        return;
      }

      // Fetch WiFi plans (independent of wallet connection)
      await fetchWifiPlans();

      // Check for MetaMask and existing connection
      if (!window.ethereum) {
        setError("MetaMask is not installed. Please install MetaMask and connect to Ganache.");
        return;
      }

      try {
        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        if (chainId !== EXPECTED_CHAIN_ID) {
          await addOrSwitchNetwork();
        }

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
          const normalizedAddress = normalizeAddress(address);
          const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

          setSigner(signer);
          setUserAddress(normalizedAddress);
          setContract(contractInstance);
          setIsWalletConnected(true);
          setError("");
          console.log("Restored wallet connection:", normalizedAddress);

          await updateWalletAddress(normalizedAddress);
          await fetchTokenBalance();
          await fetchPurchasedPlans();
        } else {
          setError("Please connect your MetaMask wallet to access blockchain features.");
        }
      } catch (err) {
        setError("Failed to initialize: " + err.message);
        console.error("Initialize error:", err);
      }

      window.ethereum.on("accountsChanged", async (accounts) => {
        if (accounts.length > 0) {
          try {
            const chainId = await window.ethereum.request({ method: "eth_chainId" });
            if (chainId !== EXPECTED_CHAIN_ID) {
              await addOrSwitchNetwork();
            }

            const staticProvider = new ethers.JsonRpcProvider(GANACHE_RPC_URL);
            const code = await staticProvider.getCode(CONTRACT_ADDRESS);
            if (code === "0x") {
              setError("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");
              return;
            }

            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const address = accounts[0];
            const normalizedAddress = normalizeAddress(address);
            const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

            setSigner(signer);
            setUserAddress(normalizedAddress);
            setContract(contractInstance);
            setIsWalletConnected(true);
            setError("");
            console.log("Reconnected wallet:", normalizedAddress);

            await updateWalletAddress(normalizedAddress);
            await fetchTokenBalance();
            await fetchPurchasedPlans();
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
            const normalizedAddress = normalizeAddress(address);
            const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

            setSigner(signer);
            setUserAddress(normalizedAddress);
            setContract(contractInstance);
            setIsWalletConnected(true);
            setError("");
            console.log("Reconnected after chain change:", normalizedAddress);

            await updateWalletAddress(normalizedAddress);
            await fetchTokenBalance();
            await fetchPurchasedPlans();
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

  return (
    <div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">WiFi Plans</h1>
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
            onClick={() => navigate("/user/dashboard")}
            className="bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
          >
            Back to Dashboard
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
              ? "Connect your MetaMask wallet to Ganache to purchase plans."
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

      {/* WiFi Plans */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Available Plans */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col">
          <h2 className="text-2xl font-semibold text-white mb-4">Available WiFi Plans</h2>
          {wifiPlans.length > 0 ? (
            <div className="overflow-y-auto flex-1">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Name</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Duration</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Price (KES)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Data (MB)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Action</th>
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
                          onClick={() => handlePurchasePlan(plan.id)}
                          disabled={isPurchasing || !isWalletConnected}
                          className={`bg-blue-500 text-white py-1 px-2 rounded-full hover:bg-blue-600 transition duration-300 ${
                            isPurchasing || !isWalletConnected ? "opacity-50 cursor-not-allowed" : ""
                          }`}
                        >
                          {isPurchasing ? "Purchasing..." : "Purchase"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300 flex-1">No WiFi plans available.</p>
          )}
        </div>

        {/* Purchased Plans */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col">
          <h2 className="text-2xl font-semibold text-white mb-4">Purchased Plans</h2>
          {purchasedPlans.length > 0 ? (
            <div className="overflow-y-auto flex-1">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Name</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Duration</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Price (KES)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Data (MB)</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Purchase Date</th>
                  </tr>
                </thead>
                <tbody>
                  {purchasedPlans.map((plan) => (
                    <tr key={plan.id} className="bg-gray-600">
                      <td className="border border-gray-600 p-3 text-white">{plan.name}</td>
                      <td className="border border-gray-600 p-3 text-white">{plan.duration}</td>
                      <td className="border border-gray-600 p-3 text-white">{plan.priceKes}</td>
                      <td className="border border-gray-600 p-3 text-white">{plan.dataMb}</td>
                      <td className="border border-gray-600 p-3 text-white">{plan.purchaseDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300 flex-1">No purchased plans.</p>
          )}
        </div>

        {/* Token Balance */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col">
          <h2 className="text-2xl font-semibold text-white mb-4">Token Balance</h2>
          <p className="text-gray-300">
            Balance: <span className="font-bold text-white">{tokenBalance} WiFiTokens</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default WiFiPlans;