import { Itim } from "next/font/google";
import "./globals.css";

const itim = Itim({
  variable: "--font-itim",
  weight: "400",
  subsets: ["latin"],
});

export const metadata = {
  title: "Audio Mixing Lab — Hand-drawn Blueprint",
  description: "Spatial audio sketchbook",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={itim.variable}>
      <body>{children}</body>
    </html>
  );
}
