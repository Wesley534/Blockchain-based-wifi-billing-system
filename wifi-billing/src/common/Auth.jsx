import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [isMetaMaskInstalled, setIsMetaMaskInstalled] = useState(false);
  const [isRequestingRegistration, setIsRequestingRegistration] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState("not_registered");
  const navigate = useNavigate();

  // Check if MetaMask is installed
  useEffect(() => {
    if (typeof window.ethereum !== "undefined") {
      setIsMetaMaskInstalled(true);
    } else {
      setError("MetaMask is not installed. Please install MetaMask to register.");
    }
  }, []);

  // Connect to MetaMask
  const connectMetaMask = async () => {
    if (!isMetaMaskInstalled) {
      setError("MetaMask is not installed. Please install MetaMask to continue.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const address = accounts[0];
      setWalletAddress(address);
      console.log("Connected MetaMask wallet:", address);
    } catch (err) {
      setError("Failed to connect to MetaMask. Please try again.");
      console.error("MetaMask connection error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Request registration (adapted from UserDashboard.js)
  const requestRegistration = async () => {
    if (!walletAddress) {
      setError("Please connect your MetaMask wallet to request registration.");
      return;
    }
    setIsRequestingRegistration(true);
    setError("");
    try {
      // First, register the user to get a token
      const registerResponse = await fetch("http://127.0.0.1:8000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role: "user" }),
      });

      const registerData = await registerResponse.json();
      if (!registerResponse.ok) {
        throw new Error(registerData.detail || "Failed to register user");
      }

      // Store token and user info
      const token = registerData.access_token;
      localStorage.setItem("token", token);
      localStorage.setItem("username", username);
      localStorage.setItem("role", registerData.role);

      // Now request registration with wallet address
      const response = await fetch("http://127.0.0.1:8000/request-registration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ wallet_address: walletAddress }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to request registration");
      }

      const data = await response.json();
      setError(data.message); // "Registration request submitted successfully"
      setRegistrationStatus("pending");
      console.log("Registration request submitted:", data);
    } catch (err) {
      setError("Failed to request registration: " + err.message);
      console.error("Request registration error:", err);
    } finally {
      setIsRequestingRegistration(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const response = await fetch("http://127.0.0.1:8000/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (response.ok) {
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("username", username);
        localStorage.setItem("role", data.role);
        if (data.role === "wifi_provider") {
          navigate("/isp/dashboard");
        } else if (data.role === "user") {
          navigate("/user/dashboard");
        } else {
          throw new Error("Unknown role received from server");
        }
      } else {
        setError(data.detail || "Login failed. Please check your username and password.");
      }
    } catch (err) {
      console.error("Login error:", err);
      if (err.name === "AbortError") {
        setError("Login request timed out after 20 seconds.");
      } else if (err.name === "TypeError" && err.message.includes("Failed to fetch")) {
        setError("Cannot connect to the server.");
      } else {
        setError("An error occurred during login. Please try again.");
      }
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
    await requestRegistration();
  };

  const toggleForm = () => {
    setIsLogin(!isLogin);
    setError("");
    setUsername("");
    setPassword("");
    setWalletAddress("");
    setRegistrationStatus("not_registered");
  };

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="bg-opacity-20 bg-white backdrop-blur-lg p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-4xl font-bold text-black text-center mb-6">
          {isLogin ? "Login" : "Register"}
        </h2>
        {error && <p className="text-red-400 text-center mb-4">{error}</p>}
        <form onSubmit={isLogin ? handleLogin : handleRegister}>
          <div className="mb-4">
            <label htmlFor servidores="username" className="block text-sm text-black font-medium mb-2">
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
          <div className="mb-6">
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
          {!isLogin && (
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
          )}
          <button
            type="submit"
            className="w-full bg-theme-blue text-white py-3 rounded-full bg-black hover:bg-blue-700 transition duration-300"
            disabled={isLoading || isRequestingRegistration}
          >
            {isLoading || isRequestingRegistration
              ? "Loading..."
              : isLogin
              ? "Login"
              : "Request Registration"}
          </button>
        </form>
        {registrationStatus === "pending" && !isLogin && (
          <p className="text-yellow-400 text-center mt-4">
            Registration request pending ISP approval.
          </p>
        )}
        <p className="text-center text-black mt-4">
          {isLogin ? "Don't have an account?" : "Already have an account?"}
          <button
            onClick={toggleForm}
            className="text-theme-blue hover:underline ml-1"
          >
            {isLogin ? "Register" : "Login"}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Auth;