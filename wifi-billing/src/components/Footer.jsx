import React from "react";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="bg-gray-900 text-white py-6">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <p>&copy; {new Date().getFullYear()} WiFi Service. All rights reserved.</p>
          </div>
          <div className="flex space-x-6">
            <Link to="/faq" className="text-theme-blue hover:underline">
              FAQ
            </Link>
            <Link to="/help" className="text-theme-blue hover:underline">
              Help
            </Link>
            <Link to="/feedback" className="text-theme-blue hover:underline">
              Feedback
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;