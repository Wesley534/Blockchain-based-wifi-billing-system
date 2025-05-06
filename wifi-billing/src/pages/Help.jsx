import React from "react";
import { useNavigate } from "react-router-dom";
import Footer from "../components/Footer";

const Help = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen p-8 bg-[linear-gradient(135deg,_#1a1a2e,_#9fc817)] text-white flex flex-col">
      <div className="flex-grow container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-center mb-8">User Guide: WiFi Management System</h1>
        <div className="max-w-4xl mx-auto bg-gray-800 rounded-lg shadow-lg p-6">
          <p className="text-gray-300 mb-6">
            Welcome to the WiFi Management System! This guide will walk you through how to use the system to manage your WiFi plans, track data usage, and make payments using MetaMask and blockchain technology.
          </p>

          {/* Table of Contents */}
          <h2 className="text-2xl font-semibold text-white mb-4">Table of Contents</h2>
          <ul className="list-disc list-inside text-gray-300 mb-6">
            <li><a href="#getting-started" className="text-blue-400 hover:underline">Getting Started</a></li>
            <li><a href="#user-dashboard" className="text-blue-400 hover:underline">Using the User Dashboard</a></li>
            <li><a href="#wifi-plans" className="text-blue-400 hover:underline">Managing WiFi Plans</a></li>
            <li><a href="#troubleshooting" className="text-blue-400 hover:underline">Troubleshooting</a></li>
            <li><a href="#contact-support" className="text-blue-400 hover:underline">Contact Support</a></li>
          </ul>

          {/* Section: Getting Started */}
          <h2 id="getting-started" className="text-2xl font-semibold text-white mb-4">1. Getting Started</h2>
          <p className="text-gray-300 mb-4">
            To use the WiFi Management System, you need to log in and connect your MetaMask wallet to the Ganache blockchain network. Follow these steps:
          </p>
          <ol className="list-decimal list-inside text-gray-300 mb-6">
            <li><strong>Log In:</strong> Access the system using your username and password. If you don’t have an account, contact your Internet Service Provider (ISP) to register.</li>
            <li><strong>Install MetaMask:</strong> Ensure MetaMask is installed in your browser. If not, download it from <a href="https://metamask.io" className="text-blue-400 hover:underline">metamask.io</a>.</li>
            <li><strong>Connect to Ganache:</strong> Configure MetaMask to connect to the Ganache network provided by your ISP. You’ll need the RPC URL and Chain ID from your ISP.</li>
            <li><strong>Connect Wallet:</strong> On the User Dashboard or WiFi Plans page, click the “Connect MetaMask” button to link your wallet. Ensure your wallet has sufficient ETH for transactions.</li>
            <li><strong>Verify Registration:</strong> Your wallet address must be registered with the ISP on the blockchain. If you see a “User not registered” error, contact your ISP.</li>
          </ol>

          {/* Section: User Dashboard */}
          <h2 id="user-dashboard" className="text-2xl font-semibold text-white mb-4">2. Using the User Dashboard</h2>
          <p className="text-gray-300 mb-4">
            The User Dashboard is your central hub for monitoring data usage, viewing your active plan, checking billing, and reviewing transaction history.
          </p>
          <h3 className="text-xl font-semibold text-white mb-2">Key Features</h3>
          <ul className="list-disc list-inside text-gray-300 mb-4">
            <li><strong>Billing Report:</strong> Displays your total data usage (in MB) and total cost (in KES).</li>
            <li><strong>Data Usage History:</strong> Shows a real-time graph of your data usage over time, including individual sessions and cumulative usage.</li>
            <li><strong>Active Plan:</strong> Displays details of your current WiFi plan, including the plan name, purchase date, and remaining data (in MB).</li>
            <li><strong>Transaction History:</strong> Lists all payment transactions, including transaction ID, amount (in KES), timestamp, and status.</li>
          </ul>
          <h3 className="text-xl font-semibold text-white mb-2">How to Use</h3>
          <ol className="list-decimal list-inside text-gray-300 mb-6">
            <li><strong>Connect Wallet:</strong> If not already connected, click “Connect MetaMask” to link your wallet. The connected wallet address will be displayed (e.g., “0x123...abcd”).</li>
            <li><strong>Log Data Usage:</strong> To test data logging, click “Log 50 MB Usage (Test)” to simulate 50 MB of data usage. This updates your usage history and active plan’s remaining data. <em>Note:</em> You must have an active plan to log usage.</li>
            <li><strong>Simulate Payment:</strong> If you have recorded data usage, click “Simulate Payment” in the Active Plan card to process a payment for your usage. This requires MetaMask approval and sufficient ETH.</li>
            <li><strong>View WiFi Plans:</strong> Click “View WiFi Plans” to purchase a new plan if you don’t have an active one.</li>
            <li><strong>Logout:</strong> Click “Logout” to end your session and disconnect your wallet.</li>
          </ol>

          {/* Section: WiFi Plans */}
          <h2 id="wifi-plans" className="text-2xl font-semibold text-white mb-4">3. Managing WiFi Plans</h2>
          <p className="text-gray-300 mb-4">
            The WiFi Plans page allows you to view available plans, purchase new plans, and review your purchased plans.
          </p>
          <h3 className="text-xl font-semibold text-white mb-2">Key Features</h3>
          <ul className="list-disc list-inside text-gray-300 mb-4">
            <li><strong>Available WiFi Plans:</strong> Lists all plans offered by the ISP, including name, duration, price (in KES and ETH), and data allowance (in MB).</li>
            <li><strong>Your Purchased Plans:</strong> Displays plans you’ve purchased, including purchase date and plan details.</li>
          </ul>
          <h3 className="text-xl font-semibold text-white mb-2">How to Use</h3>
          <ol className="list-decimal list-inside text-gray-300 mb-6">
            <li><strong>Access WiFi Plans:</strong> From the User Dashboard, click “View WiFi Plans” to navigate to the WiFi Plans page.</li>
            <li><strong>Connect Wallet:</strong> Ensure your MetaMask wallet is connected. Click “Connect MetaMask” if needed.</li>
            <li><strong>Purchase a Plan:</strong> In the “Available WiFi Plans” table, click the “Purchase” button next to the desired plan. Confirm the transaction in MetaMask to pay the plan’s price in ETH.</li>
            <li><strong>View Purchased Plans:</strong> The “Your Purchased Plans” table updates to show your newly purchased plan.</li>
            <li><strong>Return to Dashboard:</strong> Click “Back to Dashboard” to return to the User Dashboard.</li>
            <li><strong>Logout:</strong> Click “Logout” to end your session.</li>
          </ol>

          {/* Section: Troubleshooting */}
          <h2 id="troubleshooting" className="text-2xl font-semibold text-white mb-4">4. Troubleshooting</h2>
          <p className="text-gray-300 mb-4">
            If you encounter issues, try these solutions:
          </p>
          <ul className="list-disc list-inside text-gray-300 mb-6">
            <li><strong>“Session expired” or “Please log in”:</strong> Your session has timed out. Log in again.</li>
            <li><strong>“User not registered”:</strong> Your wallet address is not registered on the blockchain. Contact your ISP to register your account.</li>
            <li><strong>“Insufficient ETH”:</strong> Ensure your MetaMask wallet has enough ETH to cover the plan price or payment. Request ETH from your ISP if using a test network.</li>
            <li><strong>“Transaction rejected in MetaMask”:</strong> You declined the transaction. Retry and approve the transaction in MetaMask.</li>
            <li><strong>“No active plan found”:</strong> Purchase a plan from the WiFi Plans page to continue using the system.</li>
            <li><strong>“MetaMask not installed”:</strong> Install MetaMask from <a href="https://metamask.io" className="text-blue-400 hover:underline">metamask.io</a> and connect to Ganache.</li>
            <li><strong>Other errors:</strong> Clear the error message by clicking “Clear Error” and try again. If the issue persists, contact support.</li>
          </ul>

          {/* Section: Contact Support */}
          <h2 id="contact-support" className="text-2xl font-semibold text-white mb-4">5. Contact Support</h2>
          <p className="text-gray-300 mb-4">
            If you need further assistance, contact your ISP’s support team. Provide your wallet address and a detailed description of the issue.
          </p>
          <p className="text-gray-300 mb-6">
            <strong>Email:</strong> support@yourisp.com<br />
            <strong>Phone:</strong> +123-456-7890<br />
            <strong>Hours:</strong> Monday–Friday, 9 AM–5 PM
          </p>

          {/* Back to Dashboard Button */}
          <div className="text-center">
            <button
              onClick={() => navigate("/user/dashboard")}
              className="bg-green-500 text-white py-3 px-6 rounded-full hover:bg-green-600 transition duration-300"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Help;