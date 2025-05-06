import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Footer from "../components/Footer";

const Feedback = () => {
  const [feedback, setFeedback] = useState("");
  const [pastFeedback, setPastFeedback] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  // Check authentication and fetch feedback on mount
  useEffect(() => {
    const checkAuthAndFetchFeedback = async () => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setError("Please log in to submit feedback.");
        navigate("/");
        return;
      }

      try {
        // Verify token
        const verifyResponse = await fetch("http://127.0.0.1:8000/verify-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (verifyResponse.status === 401) {
          localStorage.removeItem("access_token");
          localStorage.removeItem("username");
          setError("Session expired. Please log in again.");
          navigate("/");
          return;
        }

        if (!verifyResponse.ok) {
          throw new Error(`Failed to verify token: ${verifyResponse.statusText}`);
        }

        const verifyData = await verifyResponse.json();
        if (verifyData.role !== "user") {
          setError("Access denied. User role required.");
          navigate("/");
          return;
        }

        // Fetch past feedback
        const feedbackResponse = await fetch("http://127.0.0.1:8000/user/feedback", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (!feedbackResponse.ok) {
          const errorData = await feedbackResponse.json();
          throw new Error(errorData.detail || "Failed to fetch feedback");
        }

        const feedbackData = await feedbackResponse.json();
        setPastFeedback(feedbackData);
      } catch (err) {
        setError(`Failed to verify session or fetch feedback: ${err.message}`);
        localStorage.removeItem("access_token");
        localStorage.removeItem("username");
        navigate("/");
      }
    };

    checkAuthAndFetchFeedback();
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

      // Refresh past feedback
      const feedbackResponse = await fetch("http://127.0.0.1:8000/user/feedback", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (feedbackResponse.ok) {
        const feedbackData = await feedbackResponse.json();
        setPastFeedback(feedbackData);
      } else {
        setError("Failed to refresh feedback history.");
      }
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
        <div className="max-w-md mx-auto bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
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
                placeholder="Share your feedback or suggestions..."
              />
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

        {/* Past Feedback Section */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6">
          <h3 className="text-2xl font-semibold mb-4">Your Feedback History</h3>
          {pastFeedback.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-600">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Feedback</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Submitted At</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Reply</th>
                    <th className="border border-gray-600 p-3 text-left text-gray-300">Replied At</th>
                  </tr>
                </thead>
                <tbody>
                  {pastFeedback.map((item) => (
                    <tr key={item.id} className="bg-gray-600">
                      <td className="border border-gray-600 p-3 text-white max-w-xs truncate">{item.feedback}</td>
                      <td className="border border-gray-600 p-3 text-white">
                        {new Date(item.created_at).toLocaleString()}
                      </td>
                      <td className="border border-gray-600 p-3 text-white max-w-xs truncate">
                        {item.reply || "No reply yet"}
                      </td>
                      <td className="border border-gray-600 p-3 text-white">
                        {item.replied_at ? new Date(item.replied_at).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-300">No feedback submitted yet.</p>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Feedback;