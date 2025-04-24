import { createContext, useState, useEffect } from "react";
import { ethers } from "ethers";
import wiFiBillingArtifact from "../utils/WiFiBilling.json";

const wiFiBillingABI = wiFiBillingArtifact.abi;
const CONTRACT_ADDRESS = "0x83c792ceC89E5A23684aDc4A3d9ca4cA6F1f8355"; // Update to your new contract address
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

      // Check if the user is the ISP
      let isISPAccount = false;
      try {
        const contractISP = await contractInstance.isp();
        isISPAccount = ethers.getAddress(contractISP) === normalizedAddress;
      } catch (err) {
        console.warn("Error checking ISP address:", err);
      }

      if (isISPAccount) {
        // Check if ISP is registered
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
        // Non-ISP user: check registration
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
      }

      setSigner(signer);
      setUserAddress(normalizedAddress);
      setContract(contractInstance);
      setIsWalletConnected(true);
      console.log("Wallet connected:", normalizedAddress);

      await updateWalletAddress(normalizedAddress);
    } catch (err) {
      let errorMessage = "Failed to connect wallet. Please try again.";
      if (err.code === 4001) errorMessage = "Wallet connection rejected. Please connect your MetaMask wallet.";
      else if (err.code === -32603) errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      else if (err.message.includes("User not registered")) errorMessage = err.message;
      else errorMessage += ` Error: ${err.message}`;
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
      throw new Error("Failed to update wallet address: " + err.message);
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
  };

  useEffect(() => {
    const initializeWallet = async () => {
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
        if (accounts.length > 0 && localStorage.getItem("token")) {
          const signer = await provider.getSigner();
          const address = await signer.getAddress();
          const normalizedAddress = normalizeAddress(address);
          const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

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
              setError("User not registered on blockchain. Please contact your ISP to register your account.");
              return;
            }
          }

          setSigner(signer);
          setUserAddress(normalizedAddress);
          setContract(contractInstance);
          setIsWalletConnected(true);
          setError("");
          console.log("Restored wallet connection:", normalizedAddress);

          await updateWalletAddress(normalizedAddress);
        } else {
          setError("Please connect your MetaMask wallet to access blockchain features.");
        }
      } catch (err) {
        setError("Failed to initialize wallet: " + err.message);
        console.error("Initialize wallet error:", err);
      }
    };

    initializeWallet();

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accounts) => {
        if (accounts.length > 0 && localStorage.getItem("token")) {
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
            const address = accounts[0];
            const normalizedAddress = normalizeAddress(address);
            const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

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
                setError("User not registered on blockchain. Please contact your ISP to register your account.");
                await disconnectWallet();
                return;
              }
            }

            setSigner(signer);
            setUserAddress(normalizedAddress);
            setContract(contractInstance);
            setIsWalletConnected(true);
            setError("");
            console.log("Reconnected wallet:", normalizedAddress);

            await updateWalletAddress(normalizedAddress);
          } catch (err) {
            setError("Failed to reconnect wallet: " + err.message);
            console.error("Accounts changed error:", err);
            await disconnectWallet();
          }
        } else {
          await disconnectWallet();
        }
      });

      window.ethereum.on("chainChanged", async (chainId) => {
        if (chainId !== EXPECTED_CHAIN_ID) {
          setError("Network changed. Please reconnect to Ganache (chain ID 1337).");
          await disconnectWallet();
        } else if (localStorage.getItem("token")) {
          try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await window.ethereum.request({ method: "eth_accounts" });
            if (accounts.length > 0) {
              const signer = await provider.getSigner();
              const address = await signer.getAddress();
              const normalizedAddress = normalizeAddress(address);
              const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, wiFiBillingABI, signer);

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
                  setError("User not registered on blockchain. Please contact your ISP to register your account.");
                  await disconnectWallet();
                  return;
                }
              }

              setSigner(signer);
              setUserAddress(normalizedAddress);
              setContract(contractInstance);
              setIsWalletConnected(true);
              setError("");
              console.log("Reconnected after chain change:", normalizedAddress);

              await updateWalletAddress(normalizedAddress);
            }
          } catch (err) {
            setError("Failed to reconnect to Ganache after network change: " + err.message);
            console.error("Chain changed error:", err);
            await disconnectWallet();
          }
        }
      });
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener("accountsChanged", () => {});
        window.ethereum.removeListener("chainChanged", () => {});
      }
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