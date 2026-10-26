import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "../styles/workspace.css";
import { MotionProvider } from "@/components/motion-provider";
import { DisplayTimezoneBootstrap } from "@/lib/hooks/display-timezone-bootstrap";
import { WorkspaceThemeController } from "@/lib/hooks/workspace-theme";
import { WORKSPACE_THEME_INIT_SCRIPT } from "@/lib/theme-preference";

// Fonts are committed under ./fonts with their SIL OFL 1.1 licence files so the
// production build never performs a font-host network fetch. `scripts/ci/font-egress.mjs`
// guards that boundary. Each file is the upstream Google Fonts latin-subset
// variable font; the declared ranges reproduce the previous build's lowest and
// highest faces, so heavier requests clamp to the same master as before.
const instrumentSans = localFont({
  src: "./fonts/instrument-sans-latin-var.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-body-next",
  display: "swap",
});

const sora = localFont({
  src: "./fonts/sora-latin-var.woff2",
  weight: "100 800",
  style: "normal",
  variable: "--font-display-next",
  display: "swap",
});

// 400–600 matches the mono faces the design system previously declared, so a
// `font-weight: 900` label keeps resolving to the 600 master as it did before.
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-var.woff2",
  weight: "400 600",
  style: "normal",
  variable: "--font-mono-next",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://egawilldoit.online"),
  title: {
    default: "EGA House",
    template: "%s | EGA House",
  },
  description:
    "Personal operating system for projects, goals, tasks, focus sessions, and weekly reviews.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "EGA House",
    description:
      "Personal operating system for projects, goals, tasks, focus sessions, and weekly reviews.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full antialiased ${instrumentSans.variable} ${sora.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script
          id="ega-workspace-theme"
          dangerouslySetInnerHTML={{ __html: WORKSPACE_THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <WorkspaceThemeController />
        <MotionProvider>
          <DisplayTimezoneBootstrap />
          {children}
        </MotionProvider>
      </body>
    </html>
  );
}
