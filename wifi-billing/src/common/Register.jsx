import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";

const Register = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [isMetaMaskInstalled, setIsMetaMaskInstalled] = useState(false);
  const [isRequestingRegistration, setIsRequestingRegistration] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState("not_registered");
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window.ethereum !== "undefined") {
      setIsMetaMaskInstalled(true);
      // Listen for account changes
      window.ethereum.on("accountsChanged", handleAccountsChanged);
      return () => {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      };
    } else {
      setError("MetaMask is not installed. Please install MetaMask to register.");
    }
  }, []);

  const handleAccountsChanged = (accounts) => {
    if (accounts.length === 0) {
      setWalletAddress("");
      setError("MetaMask disconnected. Please reconnect to continue.");
    } else {
      setWalletAddress(accounts[0]);
      console.log("MetaMask account changed:", accounts[0]);
    }
  };

  const connectMetaMask = async () => {
    if (!isMetaMaskInstalled) {
      setError("MetaMask is not installed. Please install MetaMask to continue.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      // Force MetaMask to prompt account selection by requesting permissions
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      // Get the selected account(s)
      const accounts = await provider.send("eth_accounts", []);
      if (accounts.length === 0) {
        throw new Error("No accounts selected in MetaMask.");
      }
      const address = accounts[0];
      setWalletAddress(address);
      console.log("Connected MetaMask wallet:", address);
    } catch (err) {
      let errorMessage = "Failed to connect to MetaMask";
      if (err.code === 4001) {
        errorMessage = "MetaMask connection rejected. Please select an account.";
      } else if (err.message.includes("No accounts selected")) {
        errorMessage = "No account selected in MetaMask. Please choose an account.";
      } else {
        errorMessage += `: ${err.message}`;
      }
      setError(errorMessage);
      console.error("MetaMask connection error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!walletAddress) {
      setError("Please connect your MetaMask wallet before registering.");
      return;
    }
    setIsRequestingRegistration(true);
    setError("");
    try {
      const response = await fetch("http://127.0.0.1:8000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role: "user", email }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to register user");
      }

      const token = data.access_token;
      localStorage.setItem("access_token", token);
      localStorage.setItem("username", username);
      localStorage.setItem("role", data.role);

      const regResponse = await fetch("http://127.0.0.1:8000/request-registration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ wallet_address: walletAddress }),
      });

      if (!regResponse.ok) {
        const errorData = await regResponse.json();
        throw new Error(errorData.detail || "Failed to request registration");
      }

      setError("Registration request submitted successfully. Awaiting ISP approval.");
      setRegistrationStatus("pending");
      // Redirect to login after a short delay to show success message
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError("Failed to register: " + err.message);
      console.error("Registration error:", err);
    } finally {
      setIsRequestingRegistration(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="bg-opacity-20 bg-white backdrop-blur-lg p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-4xl font-bold text-black text-center mb-6">Register</h2>
        {error && (
          <div className="text-red-400 text-center mb-4">
            <p>{error}</p>
            <button
              onClick={() => setError("")}
              className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
            >
              Clear
            </button>
          </div>
        )}
        <form onSubmit={handleRegister}>
          <div className="mb-4">
            <label htmlFor="username" className="block text-sm text-black font-medium mb-2">
              Username
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-theme-blue"
              required
            />
          </div>
          <div className="mb-4">
            <label htmlFor="email" className="block text-sm text-black font-medium mb-2">
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-theme-blue"
              required
            />
          </div>
          <div className="mb-4">
            <label htmlFor="password" className="block text-sm text-black font-medium mb-2">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-theme-blue"
              required
            />
          </div>
          <div className="mb-6">
            <button
              type="button"
              onClick={connectMetaMask}
              className="w-full bg-gray-600 text-white py-2 rounded-full hover:bg-gray-700 transition duration-300"
              disabled={isLoading || isRequestingRegistration}
            >
              {isLoading ? "Connecting..." : "Connect MetaMask"}
            </button>
            {walletAddress && (
              <p className="text-green-400 text-center mt-2">
                Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </p>
            )}
          </div>
          <button
            type="submit"
            className="w-full bg-theme-blue text-white py-3 rounded-full bg-black hover:bg-blue-700 transition duration-300"
            disabled={isLoading || isRequestingRegistration}
          >
            {isRequestingRegistration ? "Loading..." : "Request Registration"}
          </button>
        </form>
        {registrationStatus === "pending" && (
          <p className="text-yellow-400 text-center mt-4">
            Registration request pending ISP approval.
          </p>
        )}
        <p className="text-center text-black mt-4">
          Already have an account?
          <a href="/login" className="text-theme-blue hover:underline ml-1">
            Login
          </a>
        </p>
      </div>
    </div>
  );
};

export default Register;