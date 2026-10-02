import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/ibm-plex-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Overlay } from "./components/overlay/Overlay";
import { QuickPanel } from "./components/quick/QuickPanel";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) throw new Error("Poko could not find its root element.");

// The same page serves Poko's on-screen overlay and the quick panel, without the app around them.
const isOverlay = window.location.hash === "#overlay";
const isQuick = window.location.hash === "#quick";
if (isOverlay) document.documentElement.classList.add("is-overlay");
if (isQuick) document.documentElement.classList.add("is-quick");

createRoot(rootElement).render(
  <StrictMode>{isOverlay ? <Overlay /> : isQuick ? <QuickPanel /> : <App />}</StrictMode>,
);
