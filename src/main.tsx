import React from "react";
import ReactDOM from "react-dom/client";
// Establish cascade layer order before components load their own stylesheets.
import "./heroui.css";
import App from "./App";
import "./styles.css";
import "./design-system.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
