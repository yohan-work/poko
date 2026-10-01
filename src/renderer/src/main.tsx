import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/ibm-plex-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Overlay } from "./components/overlay/Overlay";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) throw new Error("Poko could not find its root element.");

// The same page serves Poko's on-screen overlay window, without the app around it.
const isOverlay = window.location.hash === "#overlay";
if (isOverlay) document.documentElement.classList.add("is-overlay");

createRoot(rootElement).render(<StrictMode>{isOverlay ? <Overlay /> : <App />}</StrictMode>);
