import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Footer from "../components/Footer";

const AdminRequests = () => {
  const [helpRequests, setHelpRequests] = useState([]);
  const [feedbackRequests, setFeedbackRequests] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const verifyTokenAndFetchRequests = async () => {
      setIsLoading(true);
      setError("");

      try {
        const token = localStorage.getItem("access_token");
        if (!token) {
          setError("No authentication token found. Redirecting to login...");
          setTimeout(() => navigate("/login"), 2000);
          return;
        }

        // Verify token and role
        const verifyResponse = await fetch("http://127.0.0.1:8000/verify-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        const verifyData = await verifyResponse.json();
        if (!verifyResponse.ok) {
          throw new Error(verifyData.detail || "Token verification failed");
        }
        if (verifyData.role !== "wifi_provider") {
          throw new Error("You do not have the required role to access this page.");
        }

        // Fetch help requests
        const helpResponse = await fetch("http://127.0.0.1:8000/isp/help-requests", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        const helpData = await helpResponse.json();
        if (!helpResponse.ok) {
          throw new Error(helpData.detail || "Failed to fetch help requests");
        }
        setHelpRequests(helpData);

        // Fetch feedback requests
        const feedbackResponse = await fetch("http://127.0.0.1:8000/isp/feedback-requests", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        const feedbackData = await feedbackResponse.json();
        if (!feedbackResponse.ok) {
          throw new Error(feedbackData.detail || "Failed to fetch feedback requests");
        }
        setFeedbackRequests(feedbackData);
      } catch (err) {
        setError("Failed to load requests: " + err.message);
        if (err.message.includes("Unauthorized") || err.message.includes("Token") || err.message.includes("role")) {
          setTimeout(() => navigate("/login"), 2000);
        }
      } finally {
        setIsLoading(false);
      }
    };

    verifyTokenAndFetchRequests();
  }, [navigate]);

  const handleLogout = async () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("username");
    navigate("/login");
  };

  return (
    <><div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-white">Admin: Help & Feedback Requests</h1>
        <div className="flex space-x-4">
          <button
            onClick={() => navigate("/isp/dashboard")}
            className="bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300"
          >
            Back to ISP Dashboard
          </button>
          <button
            onClick={handleLogout}
            className="bg-red-500 text-white py-2 px-4 rounded-full hover:bg-red-600 transition duration-300"
          >
            Logout
          </button>
        </div>
      </div>

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

      {isLoading ? (
        <div className="mb-8 p-4 bg-blue-500 text-white rounded-lg shadow-lg">
          <p>Loading requests...</p>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">Help Requests</h2>
            {helpRequests.length === 0 ? (
              <p className="text-gray-300">No help requests found.</p>
            ) : (
              <div className="space-y-4">
                {helpRequests.map((request) => (
                  <div key={request.id} className="bg-gray-700 p-6 rounded-lg">
                    <p><strong>ID:</strong> {request.id}</p>
                    <p><strong>Subject:</strong> {request.subject}</p>
                    <p><strong>Message:</strong> {request.message}</p>
                    <p><strong>Created At:</strong> {new Date(request.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">Feedback Requests</h2>
            {feedbackRequests.length === 0 ? (
              <p className="text-gray-300">No feedback requests found.</p>
            ) : (
              <div className="space-y-4">
                {feedbackRequests.map((request) => (
                  <div key={request.id} className="bg-gray-700 p-6 rounded-lg">
                    <p><strong>ID:</strong> {request.id}</p>
                    <p><strong>Feedback:</strong> {request.feedback}</p>
                    <p><strong>Created At:</strong> {new Date(request.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div><Footer /></>

  );
};

export default AdminRequests;