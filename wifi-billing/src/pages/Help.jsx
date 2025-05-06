import React, { useState } from "react";
import Footer from "../components/Footer";

const Help = () => {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("http://127.0.0.1:8000/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to submit help request");
      }

      setSuccess("Help request submitted successfully!");
      setSubject("");
      setMessage("");
    } catch (err) {
      setError("Failed to submit help request: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-800 text-white flex flex-col">
      <div className="flex-grow container mx-auto px-4 py-8">
        <h2 className="text-4xl font-bold text-center mb-8">Help Request</h2>
        <div className="max-w-md mx-auto bg-gray-700 p-6 rounded-lg">
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
          {success && (
            <div className="text-green-400 text-center mb-4">
              <p>{success}</p>
              <button
                onClick={() => setSuccess("")}
                className="mt-2 bg-gray-500 text-white py-1 px-2 rounded-full hover:bg-gray-600"
              >
                Clear
              </button>
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="subject" className="block text-sm font-medium mb-2">
                Subject
              </label>
              <input
                type="text"
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-theme-blue"
                required
              />
            </div>
            <div className="mb-4">
              <label htmlFor="message" className="block text-sm font-medium mb-2">
                Message
              </label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-theme-blue"
                rows="5"
                required
              ></textarea>
            </div>
            <button
              type="submit"
              className={`w-full py-3 rounded-full text-white transition duration-300 ${
                isLoading ? "bg-gray-600 cursor-not-allowed" : "bg-theme-blue hover:bg-blue-700"
              }`}
              disabled={isLoading}
            >
              {isLoading ? "Submitting..." : "Submit Help Request"}
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Help;