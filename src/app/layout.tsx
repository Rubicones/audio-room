import type { Metadata } from "next";
import { Itim } from "next/font/google";
import { AuthStoreProvider } from "@/components/auth/AuthStore";
import { AppToaster } from "@/components/ui/AppToaster";
import {
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_TITLE,
  OG_IMAGE_PATH,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  SITE_NAME,
  buildSocialImages,
  getSiteUrl,
} from "@/lib/siteMetadata";
import "./globals.css";

const itim = Itim({
  variable: "--font-itim",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: DEFAULT_SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "education",
  keywords: [
    "spatial audio",
    "room acoustics",
    "sound engineering",
    "audio education",
    "3D audio",
    "web audio",
    "acoustic simulation",
    "Resonance Audio",
    "Tone.js",
    "Three.js",
  ],
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
    apple: ["/favicon.svg"],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    title: DEFAULT_SITE_TITLE,
    description: DEFAULT_SITE_DESCRIPTION,
    url: getSiteUrl(),
    images: buildSocialImages({
      alt: `${SITE_NAME} interactive sound acoustics simulator`,
    }),
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_SITE_TITLE,
    description: DEFAULT_SITE_DESCRIPTION,
    images: [OG_IMAGE_PATH],
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
  other: {
    "og:image:width": String(OG_IMAGE_WIDTH),
    "og:image:height": String(OG_IMAGE_HEIGHT),
  },
};

export const viewport = {
  themeColor: "#f6f6f6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={itim.variable}>
      <body>
        <AuthStoreProvider>
          {children}
          <AppToaster />
        </AuthStoreProvider>
      </body>
    </html>
  );
}
