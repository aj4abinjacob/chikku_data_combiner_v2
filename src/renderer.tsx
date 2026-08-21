import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./components/App";
import { DatasetOverviewWindow } from "./components/DatasetOverviewWindow";
import { installIfTauri, isTauri } from "./tauri-api";
import "pdfjs-dist/web/pdf_viewer.css";
import "./styles/app.less";

installIfTauri();

if (isTauri()) {
  window.addEventListener("contextmenu", (event) => event.preventDefault());
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
const view = new URLSearchParams(window.location.search).get("view");
root.render(view === "overview" ? <DatasetOverviewWindow /> : <App />);
