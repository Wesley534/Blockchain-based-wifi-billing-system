import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Auth from "./common/Auth";
import UserDashboard from "./users/UserDashboard";
import ISPDashboard from "./isp/IspDashboard";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Auth />} />
        <Route path="/user/dashboard" element={<UserDashboard />} />
        <Route path="/isp/dashboard" element={<ISPDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;