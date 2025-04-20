import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20-second timeout
      console.log("Input username:", username);
      console.log("Sending login request:", { username, password });
      const response = await fetch("http://127.0.0.1:8000/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      console.log("Login response status:", response.status);
      console.log("Login response headers:", [...response.headers.entries()]);
      const data = await response.json();
      console.log("Login response data:", data);

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
      console.error("Login error:", err, { name: err.name, message: err.message });
      if (err.name === "AbortError") {
        setError("Login request timed out after 20 seconds. Please check if the backend is running.");
      } else if (err.name === "TypeError" && err.message.includes("Failed to fetch")) {
        setError("Cannot connect to the server. Please ensure the backend is running at http://127.0.0.1:8000.");
      } else {
        setError("An error occurred during login. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20-second timeout
      console.log("Input username:", username);
      console.log("Sending register request:", { username, password, role: "user" });
      const response = await fetch("http://127.0.0.1:8000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role: "user" }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      console.log("Register response status:", response.status);
      console.log("Register response headers:", [...response.headers.entries()]);
      const data = await response.json();
      console.log("Register response data:", data);

      if (response.ok) {
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("username", username);
        localStorage.setItem("role", data.role);
        navigate("/user/dashboard");
      } else {
        setError(data.detail || "Registration failed. Username may already exist.");
      }
    } catch (err) {
      console.error("Registration error:", err, { name: err.name, message: err.message });
      if (err.name === "AbortError") {
        setError("Registration request timed out after 20 seconds. Please check if the backend is running.");
      } else if (err.name === "TypeError" && err.message.includes("Failed to fetch")) {
        setError("Cannot connect to the server. Please ensure the backend is running at http://127.0.0.1:8000.");
      } else {
        setError("An error occurred during registration. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleForm = () => {
    setIsLogin(!isLogin);
    setError("");
    setUsername("");
    setPassword("");
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
          <button
            type="submit"
            className="w-full bg-theme-blue text-white py-3 rounded-full bg-black hover:bg-blue-700 transition duration-300"
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : (isLogin ? "Login" : "Register")}
          </button>
        </form>
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