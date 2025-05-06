import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Footer from "../components/Footer";

const Feedback = () => {
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setError("Please log in to submit feedback.");
        navigate("/");
        return;
      }

      try {
        const response = await fetch("http://127.0.0.1:8000/verify-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.status === 401) {
          localStorage.removeItem("access_token");
          localStorage.removeItem("username");
          setError("Session expired. Please log in again.");
          navigate("/");
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to verify token: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.role !== "user") {
          setError("Access denied. User role required.");
          navigate("/");
        }
      } catch (err) {
        setError(`Failed to verify session: ${err.message}`);
        localStorage.removeItem("access_token");
        localStorage.removeItem("username");
        navigate("/");
      }
    };

    checkAuth();
  }, [navigate]);

  // Handle feedback submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccess("");

    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch("http://127.0.0.1:8000/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ feedback }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to submit feedback");
      }

      setSuccess("Feedback submitted successfully!");
      setFeedback("");
    } catch (err) {
      setError("Failed to submit feedback: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("username");
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)] text-white flex flex-col">
      <div className="flex-grow container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-4xl font-bold">Feedback</h2>
          <div className="flex space-x-4 items-center">
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

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-8 p-4 bg-red-500 text-white rounded-lg shadow-lg">
            <p>{error}</p>
            <button
              onClick={() => setError("")}
              className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
            >
              Clear
            </button>
          </div>
        )}
        {success && (
          <div className="mb-8 p-4 bg-green-500 text-white rounded-lg shadow-lg">
            <p>{success}</p>
            <button
              onClick={() => setSuccess("")}
              className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
            >
              Clear
            </button>
          </div>
        )}

        {/* Feedback Form */}
        <div className="max-w-md mx-auto bg-gray-800 p-6 rounded-lg shadow-lg">
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="feedback" className="block text-sm font-medium mb-2">
                Your Feedback
              </label>
              <textarea
                id="feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className="w-full p-3 rounded-lg bg-gray-900 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows="5"
                required
              ></textarea>
            </div>
            <button
              type="submit"
              className={`w-full py-3 rounded-full text-white transition duration-300 ${
                isLoading ? "bg-gray-600 cursor-not-allowed" : "bg-blue-500 hover:bg-blue-600"
              }`}
              disabled={isLoading}
            >
              {isLoading ? "Submitting..." : "Submit Feedback"}
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Feedback;