import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { WalletProvider } from "./context/WalletContext";
import Login from "./common/Login";
import Register from "./common/Register";
import OTPVerification from "./components/OTPVerification";
import UserDashboard from "./users/UserDashboard";
import ISPDashboard from "./isp/IspDashboard";
import WiFiPlans from "./users/WiFiPlans";

function App() {
  return (
    <WalletProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/otp-verification" element={<OTPVerification />} />
          <Route path="/user/dashboard" element={<UserDashboard />} />
          <Route path="/isp/dashboard" element={<ISPDashboard />} />
          <Route path="/wifi-plans" element={<WiFiPlans />} />
        </Routes>
      </Router>
    </WalletProvider>
  );
}

export default App;