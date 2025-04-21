import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Auth from "./common/Auth";
import UserDashboard from "./users/UserDashboard";
import ISPDashboard from "./isp/IspDashboard";
import WiFiPlans from "./users/WiFiPlans";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Auth />} />
        <Route path="/user/dashboard" element={<UserDashboard />} />
        <Route path="/isp/dashboard" element={<ISPDashboard />} />
        <Route path="/wifi-plans" element={<WiFiPlans />} />
        {/* Add more routes as needed */}
      </Routes>
    </Router>
  );
}

export default App;