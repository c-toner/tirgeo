import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles/global.css";

// Apply the saved theme before first paint to avoid a flash.
document.documentElement.dataset.theme = localStorage.getItem("tirgeo.theme") ?? "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
