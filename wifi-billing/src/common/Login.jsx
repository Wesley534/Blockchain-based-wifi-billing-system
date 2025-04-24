import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate(); // Fixed variable name

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
        body: JSON.stringify({ username, password, email }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (response.ok) {
        localStorage.setItem("temp_token", data.temp_token);
        localStorage.setItem("username", username);
        localStorage.setItem("role", data.role);
        navigate("/otp-verification");
      } else {
        setError(data.detail || "Login failed. Please check your credentials.");
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

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="bg-opacity-20 bg-white backdrop-blur-lg p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-4xl font-bold text-black text-center mb-6">Login</h2>
        {error && <p className="text-red-400 text-center mb-4">{error}</p>}
        <form onSubmit={handleLogin}>
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
            {isLoading ? "Loading..." : "Login"}
          </button>
        </form>
        <p className="text-center text-black mt-4">
          Don't have an account?
          <a href="/register" className="text-theme-blue hover:underline ml-1">
            Register
          </a>
        </p>
      </div>
    </div>
  );
};

export default Login;