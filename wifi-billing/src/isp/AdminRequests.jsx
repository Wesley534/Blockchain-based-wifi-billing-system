import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Footer from "../components/Footer";

const AdminRequests = () => {
  const [feedbackRequests, setFeedbackRequests] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [replyModal, setReplyModal] = useState({
    isOpen: false,
    requestId: null,
    replyMessage: "",
    isSubmitting: false,
  });
  const [successMessage, setSuccessMessage] = useState("");
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
        setError("Failed to load feedback requests: " + err.message);
        if (err.message.includes("Unauthorized") || err.message.includes("Token") || err.message.includes("role")) {
          setTimeout(() => navigate("/login"), 2000);
        }
      } finally {
        setIsLoading(false);
      }
    };

    verifyTokenAndFetchRequests();
  }, [navigate]);

  const openReplyModal = (requestId) => {
    setReplyModal({
      isOpen: true,
      requestId,
      replyMessage: "",
      isSubmitting: false,
    });
    setSuccessMessage("");
  };

  const closeReplyModal = () => {
    setReplyModal({
      isOpen: false,
      requestId: null,
      replyMessage: "",
      isSubmitting: false,
    });
  };

  const handleReplySubmit = async (e) => {
    e.preventDefault();
    setReplyModal((prev) => ({ ...prev, isSubmitting: true }));
    setError("");
    setSuccessMessage("");

    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        throw new Error("No authentication token found. Please log in again.");
      }

      const response = await fetch(`http://127.0.0.1:8000/isp/feedback-requests/${replyModal.requestId}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reply: replyModal.replyMessage }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to submit reply");
      }

      // Update the feedback request with the reply
      setFeedbackRequests((prev) =>
        prev.map((req) =>
          req.id === replyModal.requestId
            ? { ...req, reply: replyModal.replyMessage, replied_at: new Date().toISOString() }
            : req
        )
      );

      setSuccessMessage("Reply sent successfully!");
      closeReplyModal();
    } catch (err) {
      setError("Failed to send reply: " + err.message);
    } finally {
      setReplyModal((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("username");
    navigate("/login");
  };

  return (
    <>
      <div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)]">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-white">Admin: Feedback Requests</h1>
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

        {successMessage && (
          <div className="mb-8 p-4 bg-green-500 text-white rounded-lg shadow-lg">
            <p>{successMessage}</p>
            <button
              onClick={() => setSuccessMessage("")}
              className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
            >
              Clear
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="mb-8 p-4 bg-blue-500 text-white rounded-lg shadow-lg">
            <p>Loading feedback requests...</p>
          </div>
        ) : (
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
                    {request.reply ? (
                      <>
                        <p><strong>Reply:</strong> {request.reply}</p>
                        <p><strong>Replied At:</strong> {new Date(request.replied_at).toLocaleString()}</p>
                      </>
                    ) : (
                      <button
                        onClick={() => openReplyModal(request.id)}
                        className="mt-4 bg-green-500 text-white py-2 px-4 rounded-full hover:bg-green-600 transition duration-300"
                      >
                        Reply
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reply Modal */}
        {replyModal.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-2xl font-semibold text-white mb-4">Reply to Feedback Request</h3>
              <form onSubmit={handleReplySubmit}>
                <div className="mb-4">
                  <label htmlFor="replyMessage" className="block text-sm font-medium text-gray-300 mb-2">
                    Reply Message
                  </label>
                  <textarea
                    id="replyMessage"
                    value={replyModal.replyMessage}
                    onChange={(e) => setReplyModal((prev) => ({ ...prev, replyMessage: e.target.value }))}
                    className="w-full p-3 rounded-lg bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows="5"
                    required
                  ></textarea>
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={closeReplyModal}
                    className="bg-gray-500 text-white py-2 px-4 rounded-full hover:bg-gray-600 transition duration-300"
                    disabled={replyModal.isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600 transition duration-300 ${
                      replyModal.isSubmitting ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    disabled={replyModal.isSubmitting}
                  >
                    {replyModal.isSubmitting ? "Sending..." : "Send Reply"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </>
  );
};

export default AdminRequests;