import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/ibm-plex-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) throw new Error("Poko could not find its root element.");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
