import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const OTPVerification = () => {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Get temp_token from localStorage
      const tempToken = localStorage.getItem("temp_token");
      if (!tempToken) {
        throw new Error("No temporary token found. Please log in again.");
      }

      // Log request details for debugging
      console.log("Sending OTP verification request:", {
        otp,
        tempToken: tempToken.slice(0, 10) + "...", // Log partial token for security
        body: JSON.stringify({ otp }),
      });

      const response = await fetch("http://127.0.0.1:8000/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ otp: otp.trim() }), // Trim to avoid whitespace issues
      });

      const data = await response.json();
      console.log("Response from /verify-otp:", data);

      if (response.ok) {
        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("role", data.role);
        localStorage.removeItem("temp_token");
        if (data.role === "user") {
          navigate("/user/dashboard");
        } else if (data.role === "wifi_provider") {
          navigate("/isp/dashboard");
        } else {
          setError("Unknown role received.");
        }
      } else {
        const errorMessage = data.detail
          ? Array.isArray(data.detail)
            ? data.detail.map((err) => err.msg).join("; ")
            : data.detail
          : "Failed to verify OTP.";
        setError(errorMessage);
      }
    } catch (err) {
      console.error("OTP verification error:", err);
      setError(err.message || "An error occurred during OTP verification.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="bg-opacity-20 bg-white backdrop-blur-lg p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-4xl font-bold text-black text-center mb-6">Verify OTP</h2>
        {error && <p className="text-red-400 text-center mb-4">{error}</p>}
        <form onSubmit={handleVerifyOTP}>
          <div className="mb-4">
            <label htmlFor="otp" className="block text-sm text-black font-medium mb-2">
              OTP
            </label>
            <input
              type="text"
              id="otp"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-theme-blue"
              required
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="w-full bg-theme-blue text-white py-3 rounded-full bg-black hover:bg-blue-700 transition duration-300"
            disabled={isLoading || !otp.trim()}
          >
            {isLoading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>
        <p className="text-center text-black mt-4">
          Back to
          <a href="/login" className="text-theme-blue hover:underline ml-1">
            Login
          </a>
        </p>
      </div>
    </div>
  );
};

export default OTPVerification;