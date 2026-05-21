"use client";

import { Toaster } from "react-hot-toast";

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      containerStyle={{
        bottom: 24,
        right: 24,
      }}
      toastOptions={{
        duration: 2600,
        style: {
          background: "transparent",
          boxShadow: "none",
          border: "none",
          padding: 0,
        },
      }}
    />
  );
}
