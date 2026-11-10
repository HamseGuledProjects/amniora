import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BRAND } from "../lib/brand";
import PortfolioDemoBanner from "../components/layout/PortfolioDemoBanner";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo";

const socialImage = {
  url: `${BRAND.url}/brand/amniora-logo.png`,
  width: 1536,
  height: 1024,
  alt: "Amniora logo",
};

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  applicationName: BRAND.name,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND.name,
  },
  title: {
    default: "Amniora | Hands-on Cybersecurity Investigation Labs",
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  icons: {
    icon: [
      {
        url: "/favicon-16x16.png?v=20260731-2",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/favicon-32x32.png?v=20260731-2",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/favicon-48x48.png?v=20260731-2",
        sizes: "48x48",
        type: "image/png",
      },
      {
        url: "/favicon.ico?v=20260731-2",
        sizes: "16x16 32x32 48x48",
        type: "image/x-icon",
      },
    ],
    shortcut: [
      {
        url: "/favicon.ico?v=20260731-2",
        sizes: "16x16 32x32 48x48",
        type: "image/x-icon",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png?v=20260731-2",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    type: "website",
    url: BRAND.url,
    siteName: BRAND.name,
    locale: "en_GB",
    title: "Amniora | Hands-on Cybersecurity Investigation Labs",
    description: BRAND.description,
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Amniora | Hands-on Cybersecurity Investigation Labs",
    description: BRAND.description,
    images: [socialImage],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="flex min-h-screen min-h-dvh flex-col">
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify([organizationJsonLd, websiteJsonLd]) }}
        />
        <PortfolioDemoBanner publicOnly />
        <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
