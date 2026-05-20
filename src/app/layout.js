import { Itim } from "next/font/google";
import "./globals.css";

const itim = Itim({
  variable: "--font-itim",
  weight: "400",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Audio Mixing Lab — Hand-drawn Blueprint",
    template: "%s | Audio Mixing Lab",
  },
  description:
    "Interactive 3D spatial audio mixing lab with hand-drawn blueprint visuals, diffraction-aware obstacle acoustics, and real-time educational sound field overlays.",
  keywords: [
    "spatial audio",
    "3D audio",
    "audio mixing",
    "room acoustics",
    "sound diffraction",
    "web audio",
    "Resonance Audio",
    "acoustic simulation",
  ],
  applicationName: "Audio Mixing Lab",
  category: "music",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
    apple: ["/favicon.svg"],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "Audio Mixing Lab — Hand-drawn Blueprint",
    description:
      "Explore source placement, panning, attenuation, shadows, and diffraction in an interactive blueprint-style spatial audio room.",
    siteName: "Audio Mixing Lab",
    images: [
      {
        url: "/favicon.svg",
        width: 100,
        height: 100,
        alt: "Audio Mixing Lab icon",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Audio Mixing Lab — Hand-drawn Blueprint",
    description:
      "Interactive blueprint-style spatial audio simulator with real-time acoustic visualization.",
    images: ["/favicon.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport = {
  themeColor: "#f6f6f6",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={itim.variable}>
      <body>{children}</body>
    </html>
  );
}
