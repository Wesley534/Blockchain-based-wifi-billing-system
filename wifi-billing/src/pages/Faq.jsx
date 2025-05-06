import React from "react";
import Footer from "../components/Footer";

const FAQ = () => {
  const faqs = [
    {
      question: "How do I register for the WiFi service?",
      answer:
        "To register, go to the Register page, enter a strong password, valid email, and connect your MetaMask wallet. Your registration will be pending ISP approval.",
    },
    {
      question: "What is a strong password?",
      answer:
        "A strong password is at least 8 characters long and includes uppercase letters, lowercase letters, numbers, and special characters (e.g., !@#$%).",
    },
    {
      question: "How do I know if my registration is approved?",
      answer:
        "You will receive an email confirmation once the ISP approves your registration. You can then log in using your credentials.",
    },
    {
      question: "What is MetaMask, and why do I need it?",
      answer:
        "MetaMask is a cryptocurrency wallet used to interact with blockchain networks. It’s required to provide a wallet address for registration and plan purchases.",
    },
    {
      question: "How can I contact support?",
      answer:
        "Visit the Help page to submit a help request, and our team will respond as soon as possible.",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-800 text-white flex flex-col">
      <div className="flex-grow container mx-auto px-4 py-8">
        <h2 className="text-4xl font-bold text-center mb-8">Frequently Asked Questions</h2>
        <div className="space-y-6">
          {faqs.map((faq, index) => (
            <div key={index} className="bg-gray-700 p-6 rounded-lg">
              <h3 className="text-xl font-semibold mb-2">{faq.question}</h3>
              <p className="text-gray-300">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default FAQ;