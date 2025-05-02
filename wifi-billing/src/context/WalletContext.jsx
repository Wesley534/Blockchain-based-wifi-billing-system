import { createContext, useState, useEffect } from "react";
import { ethers } from "ethers";
import wiFiBillingArtifact from "../utils/WiFiBilling.json";

const wiFiBillingABI = wiFiBillingArtifact.abi;
const CONTRACT_ADDRESS = "0xBe11b2aC5a5e9Fe27294F5B580036A4486E2B326"; // Update to your new contract address
const GANACHE_RPC_URL = "http://127.0.0.1:7545";
const EXPECTED_CHAIN_ID = "0x539"; // Ganache chain ID (1337 in hex)
const GANACHE_NETWORK_NAME = "Ganache";

if (!ethers.isAddress(CONTRACT_ADDRESS)) {
  console.error("Invalid CONTRACT_ADDRESS:", CONTRACT_ADDRESS);
  throw new Error("CONTRACT_ADDRESS is not a valid Ethereum address");
}

export const WalletContext = createContext();

export const WalletProvider = ({ children }) => {
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [userAddress, setUserAddress] = useState("");
  const [contract, setContract] = useState(null);
  const [signer, setSigner] = useState(null);
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isISP, setIsISP] = useState(false);

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

  const normalizeAddress = (address) => {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }
    return ethers.getAddress(address);
  };

  const registerISP = async (contractInstance) => {
    try {
      const tx = await contractInstance.registerISP();
      await tx.wait();
      console.log(`ISP registered: ${await contractInstance.isp()}`);
    } catch (err) {
      throw new Error(`Failed to register ISP: ${err.reason || err.message}`);
    }
  };

  const initializeWallet = async (provider, address) => {
    try {
      const signer = await provider.getSigner();
      const normalizedAddress = normalizeAddress(address);
      const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

      const staticProvider = new ethers.JsonRpcProvider(GANACHE_RPC_URL);
      const code = await staticProvider.getCode(CONTRACT_ADDRESS);
      if (code === "0x") {
        throw new Error("No contract found at the specified address. Please check CONTRACT_ADDRESS or redeploy.");
      }

      // Check if the user is the ISP
      let isISPAccount = false;
      try {
        const contractISP = await contractInstance.isp();
        isISPAccount = ethers.getAddress(contractISP) === normalizedAddress;
      } catch (err) {
        console.warn("Error checking ISP address:", err);
      }

      if (isISPAccount) {
        let isRegistered = false;
        try {
          isRegistered = await contractInstance.isUserRegistered(normalizedAddress);
        } catch (err) {
          if (err.code === "CALL_EXCEPTION") {
            console.warn(`isUserRegistered reverted for ${normalizedAddress}: ${err.reason || "Assuming ISP not registered"}`);
          } else {
            throw err;
          }
        }

        if (!isRegistered) {
          await registerISP(contractInstance);
        }
        setIsISP(true);
      } else {
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
          throw new Error("User not registered on blockchain. Please contact your ISP to register your account.");
        }
      }

      setSigner(signer);
      setUserAddress(normalizedAddress);
      setContract(contractInstance);
      setIsWalletConnected(true);
      setError("");
      console.log("Initialized wallet:", normalizedAddress);

      await updateWalletAddress(normalizedAddress);
    } catch (err) {
      throw new Error(`Failed to initialize wallet: ${err.message}`);
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("MetaMask is not installed. Please install MetaMask and connect to Ganache.");
      return;
    }

    setIsConnecting(true);
    setError("");
    try {
      await addOrSwitchNetwork();
      const provider = new ethers.BrowserProvider(window.ethereum);
      // Force MetaMask to prompt account selection
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      // Get the selected account(s)
      const accounts = await provider.send("eth_accounts", []);
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts selected in MetaMask.");
      }

      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (chainId !== EXPECTED_CHAIN_ID) {
        throw new Error("Failed to connect to Ganache (chain ID 1337). Please try again.");
      }

      await initializeWallet(provider, accounts[0]);
      console.log("Wallet connected:", accounts[0]);
    } catch (err) {
      let errorMessage = "Failed to connect wallet. Please try again.";
      if (err.code === 4001) {
        errorMessage = "You rejected the MetaMask connection. Please select an account to continue.";
      } else if (err.message.includes("No accounts selected")) {
        errorMessage = "No account selected in MetaMask. Please choose an account.";
      } else if (err.code === -32603) {
        errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
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
      setIsISP(false);
      console.error("Connect wallet error:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const updateWalletAddress = async (walletAddress) => {
    try {
      const token = localStorage.getItem("access_token");
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
      console.error("Failed to update wallet address:", err.message);
      setError("Failed to update wallet address: " + err.message);
    }
  };

  const disconnectWallet = async () => {
    setIsWalletConnected(false);
    setUserAddress("");
    setContract(null);
    setSigner(null);
    setIsISP(false);
    setError("Wallet disconnected.");
    console.log("Wallet disconnected");
    // Avoid revoking permissions unless explicitly requested
  };

  useEffect(() => {
    if (!window.ethereum) {
      setError("MetaMask is not installed. Please install MetaMask and connect to Ganache.");
      return;
    }

    const handleAccountsChanged = async (accounts) => {
      if (accounts.length > 0 && localStorage.getItem("access_token")) {
        try {
          const chainId = await window.ethereum.request({ method: "eth_chainId" });
          if (chainId !== EXPECTED_CHAIN_ID) {
            setError("Network changed. Please reconnect to Ganache (chain ID 1337).");
            await disconnectWallet();
            return;
          }

          const provider = new ethers.BrowserProvider(window.ethereum);
          await initializeWallet(provider, accounts[0]);
          console.log("Reconnected wallet:", accounts[0]);
        } catch (err) {
          setError("Failed to reconnect wallet: " + err.message);
          console.error("Accounts changed error:", err);
          await disconnectWallet();
        }
      } else {
        await disconnectWallet();
      }
    };

    const handleChainChanged = async (chainId) => {
      if (chainId !== EXPECTED_CHAIN_ID) {
        setError("Network changed. Please reconnect to Ganache (chain ID 1337).");
        await disconnectWallet();
      } else if (localStorage.getItem("access_token")) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const accounts = await window.ethereum.request({ method: "eth_accounts" });
          if (accounts.length > 0) {
            await initializeWallet(provider, accounts[0]);
            console.log("Reconnected after chain change:", accounts[0]);
          }
        } catch (err) {
          setError("Failed to reconnect to Ganache after network change: " + err.message);
          console.error("Chain changed error:", err);
          await disconnectWallet();
        }
      }
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    // Do not automatically initialize wallet to avoid auto-connect
    // Check MetaMask installation and network only
    const checkMetaMask = async () => {
      try {
        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        if (chainId !== EXPECTED_CHAIN_ID) {
          setError("Please connect to Ganache (chain ID 1337).");
        }
      } catch (err) {
        setError("Failed to check MetaMask network: " + err.message);
        console.error("MetaMask check error:", err);
      }
    };
    checkMetaMask();

    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  return (
    <WalletContext.Provider
      value={{
        isWalletConnected,
        userAddress,
        contract,
        signer,
        error,
        setError,
        isConnecting,
        isISP,
        connectWallet,
        disconnectWallet,
        updateWalletAddress,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};