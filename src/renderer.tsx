import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./components/App";
import { installIfTauri, isTauri } from "./tauri-api";
import "./styles/app.less";

installIfTauri();

if (isTauri()) {
  window.addEventListener("contextmenu", (event) => event.preventDefault());
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<App />);
