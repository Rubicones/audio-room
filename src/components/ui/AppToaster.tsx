"use client";

import { Toaster } from "react-hot-toast";

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 2600,
        style: {
          border: "2px solid #1a1a1a",
          borderRadius: "10px",
          background: "#ffffff",
          color: "#1a1a1a",
          fontFamily: "var(--font-itim), Itim, cursive, system-ui",
          fontSize: "14px",
          boxShadow: "6px 6px 0 rgba(0, 0, 0, 0.08)",
        },
        success: {
          iconTheme: {
            primary: "#1f7a3d",
            secondary: "#ffffff",
          },
        },
        error: {
          iconTheme: {
            primary: "#a12020",
            secondary: "#ffffff",
          },
        },
      }}
    />
  );
}
