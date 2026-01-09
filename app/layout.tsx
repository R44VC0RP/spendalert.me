import type { Metadata, Viewport } from "next";
import { Geist_Mono, Outfit } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["600"],
});

const dieGrotesk = localFont({
  src: [
    {
      path: "../public/fonts/die-grotesk/DieGrotesk-A-Hairline.woff2",
      weight: "100",
      style: "normal",
    },
    {
      path: "../public/fonts/die-grotesk/DieGrotesk-A-Thin.woff2",
      weight: "200",
      style: "normal",
    },
    {
      path: "../public/fonts/die-grotesk/DieGrotesk-A-Light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../public/fonts/die-grotesk/DieGrotesk-A-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/die-grotesk/DieGrotesk-A-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/die-grotesk/DieGrotesk-A-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/fonts/die-grotesk/DieGrotesk-A-Heavy.woff2",
      weight: "800",
      style: "normal",
    },
    {
      path: "../public/fonts/die-grotesk/DieGrotesk-A-Black.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  variable: "--font-die-grotesk",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SpendAlert",
  description: "Personal finance dashboard",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SpendAlert",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${outfit.variable} ${dieGrotesk.variable} ${geistMono.variable}`}>
      <head>
        {/* iOS PWA Icons */}
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link
          rel="apple-touch-icon"
          sizes="152x152"
          href="/icons/icon-152.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/icons/icon-180.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="167x167"
          href="/icons/icon-167.png"
        />

        {/* iOS Splash Screens */}
        {/* iPhone 15 Pro Max, 15 Plus, 14 Pro Max */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1290x2796.png"
        />
        {/* iPhone 15 Pro, 15, 14 Pro */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1179x2556.png"
        />
        {/* iPhone 14 Plus, 13 Pro Max, 12 Pro Max */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1284x2778.png"
        />
        {/* iPhone 14, 13 Pro, 13, 12 Pro, 12 */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1170x2532.png"
        />
        {/* iPhone 13 mini, 12 mini, 11 Pro, XS, X */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1125x2436.png"
        />
        {/* iPhone 11 Pro Max, XS Max */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1242x2688.png"
        />
        {/* iPhone 11, XR */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)"
          href="/splash/splash-828x1792.png"
        />
        {/* iPhone 8 Plus, 7 Plus, 6s Plus */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1242x2208.png"
        />
        {/* iPhone 8, 7, 6s, 6, SE (2nd/3rd gen) */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)"
          href="/splash/splash-750x1334.png"
        />
        {/* iPhone SE (1st gen), 5s */}
        <link
          rel="apple-touch-startup-image"
          media="screen and (device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)"
          href="/splash/splash-640x1136.png"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
