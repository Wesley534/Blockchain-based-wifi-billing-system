import { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";

import { WalletContext } from "../context/WalletContext"; // Import WalletContext
import { getEthToKesRate } from "../utils/exchangeRate";

const WiFiPlans = () => {
  const [wifiPlans, setWifiPlans] = useState([]);
  const [purchasedPlans, setPurchasedPlans] = useState([]);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [ethToKesRate, setEthToKesRate] = useState(247789.20); // Fallback rate
  const navigate = useNavigate();

  // Access wallet context
  const {
    isWalletConnected,
    isConnecting,
    userAddress,
    contract,
    error,
    setError,
    connectWallet,
    handleLogout,
  } = useContext(WalletContext);

  // Fetch exchange rate on mount
  useEffect(() => {
    const fetchExchangeRate = async () => {
      const rate = await getEthToKesRate();
      setEthToKesRate(rate);
    };
    fetchExchangeRate();
  }, []);

  // Fetch WiFi plans from backend
  const fetchWifiPlans = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/wifi-plans", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      setWifiPlans(backendPlans);
      console.log("Fetched WiFi plans:", backendPlans);
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

      const planIds = await contract.getPurchasedPlans(userAddress);
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No authentication token found. Please log in again.");

      const response = await fetch("http://127.0.0.1:8000/wifi-plans", {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to fetch WiFi plans");
      }

      const allPlans = await response.json();
      const purchasedPlansData = planIds
        .map((planId) => allPlans.find((plan) => plan.id === Number(planId)))
        .filter((plan) => plan !== undefined)
        .map((plan) => ({
          id: plan.id,
          name: plan.name,
          duration: plan.duration,
          priceKes: plan.price_kes,
          priceEth: (plan.price_kes / ethToKesRate).toFixed(6),
          dataMb: plan.data_mb,
          purchaseDate: new Date().toISOString().replace("T", " ").substring(0, 19), // Placeholder
        }));

      setPurchasedPlans(purchasedPlansData);
      console.log(`Purchased plans for ${userAddress}:`, purchasedPlansData);
    } catch (err) {
      let errorMessage = "Failed to fetch purchased plans";
      if (err.code === "CALL_EXCEPTION") errorMessage = `Contract call failed: ${err.reason || "Possible user not registered"}`;
      else if (err.code === -32603) errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      else errorMessage += `: ${err.message}`;
      setError(errorMessage);
      console.error(`Fetch purchased plans error for ${userAddress}:`, err);
    }
  };

  // Purchase plan with ETH
  const handlePurchasePlan = async (planId, priceKes) => {
    if (!contract || !userAddress || !isWalletConnected) {
      setError("Cannot purchase plan: Please connect your wallet");
      return;
    }
    if (!Number.isInteger(planId) || planId <= 0) {
      setError("Invalid plan ID. Please select a valid plan.");
      return;
    }
    if (!Number.isFinite(priceKes) || priceKes <= 0) {
      setError("Invalid plan price. Please select a valid plan.");
      return;
    }

    setIsPurchasing(true);
    setError("");
    try {
      console.log(`Purchasing plan ID ${planId} for ${userAddress} with price ${priceKes} KES`);

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
        throw new Error("User not registered on blockchain. Please contact your ISP to register your account.");
      }

      const priceEth = priceKes / ethToKesRate;
      const priceWei = ethers.parseEther(priceEth.toFixed(18));

      const tx = await contract.purchasePlan(planId, priceWei, {
        value: priceWei,
        gasLimit: 300000,
      });
      await tx.wait();

      await fetchPurchasedPlans();
      alert(`Successfully purchased plan ID ${planId} for ${priceEth.toFixed(6)} ETH (${priceKes} KES)!`);
    } catch (err) {
      let errorMessage = "Failed to purchase plan";
      if (err.code === 4001) errorMessage = "Transaction rejected in MetaMask. Please approve the transaction.";
      else if (err.code === "CALL_EXCEPTION") errorMessage = `Contract call failed: ${err.reason || "Check plan ID or contract state"}`;
      else if (err.code === -32603) errorMessage = `Internal JSON-RPC error: ${err.message}. Check Ganache or contract state.`;
      else if (err.message.includes("User not registered")) errorMessage = err.message;
      else if (err.message.includes("Insufficient ETH")) errorMessage = "Insufficient ETH to purchase this plan.";
      else errorMessage += `: ${err.message}`;
      setError(errorMessage);
      console.error(`Purchase plan error for ${userAddress}:`, err);
    } finally {
      setIsPurchasing(false);
    }
  };

  // Initialize and fetch plans
  useEffect(() => {
    const initialize = async () => {
      const token = localStorage.getItem("token");
      if (!token) {
        setError("Please log in to access WiFi plans.");
        navigate("/");
        return;
      }

      await fetchWifiPlans();
      if (isWalletConnected && userAddress && contract) {
        await fetchPurchasedPlans();
      }
    };

    initialize();
  }, [navigate, isWalletConnected, userAddress, contract]);

  return (
    <div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">WiFi Plans</h1>
        <div className="flex space-x-4 items-center">
          {isWalletConnected && userAddress ? (
            <>
              <span className="text-white py-2 px-4">
                Connected: {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
              </span>
              <button
                onClick={connectWallet}
                disabled={isConnecting}
                className={`bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300 ${
                  isConnecting ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {isConnecting ? "Connecting..." : "Update Wallet Address"}
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

      {/* Available Plans */}
      <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
        <h2 className="text-2xl font-semibold text-white mb-4">Available WiFi Plans</h2>
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
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Action</th>
                </tr>
              </thead>
              <tbody>
                {wifiPlans.map((plan) => (
                  <tr key={plan.id} className="bg-gray-600">
                    <td className="border border-gray-600 p-3 text-white">{plan.name}</td>
                    <td className="border border-gray-600 p-3 text-white">{plan.duration}</td>
                    <td className="border border-gray-600 p-3 text-white">{plan.price_kes}</td>
                    <td className="border border-gray-600 p-3 text-white">{(plan.price_kes / ethToKesRate).toFixed(6)}</td>
                    <td className="border border-gray-600 p-3 text-white">{plan.data_mb}</td>
                    <td className="border border-gray-600 p-3 text-white">
                      <button
                        onClick={() => handlePurchasePlan(plan.id, plan.price_kes)}
                        disabled={isPurchasing || !isWalletConnected}
                        className={`bg-green-500 text-white py-1 px-2 rounded-full hover:bg-green-600 transition duration-300 ${
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
          <p className="text-gray-300">No WiFi plans available.</p>
        )}
      </div>

      {/* Purchased Plans */}
      <div className="bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-semibold text-white mb-4">Your Purchased Plans</h2>
        {purchasedPlans.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-gray-600">
              <thead>
                <tr className="bg-gray-700">
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Name</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Duration</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Price (KES)</th>
                  <th className="border border-gray-600 p-3 text-left text-gray-300">Price (ETH)</th>
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
                    <td className="border border-gray-600 p-3 text-white">{plan.priceEth}</td>
                    <td className="border border-gray-600 p-3 text-white">{plan.dataMb}</td>
                    <td className="border border-gray-600 p-3 text-white">{plan.purchaseDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-300">No purchased plans.</p>
        )}
      </div>
    </div>
  );
};

export default WiFiPlans;