import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import StaffPortal from "./StaffPortal.jsx";
import "./styles.css";

const isStaffRoute = window.location.pathname === "/staff" ||
  window.location.pathname.startsWith("/staff/");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isStaffRoute ? <StaffPortal /> : <App />}
  </React.StrictMode>,
);
