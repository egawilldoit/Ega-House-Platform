import type { Metadata } from "next";
import { Instrument_Sans, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "../styles/workspace.css";
import { MotionProvider } from "@/components/motion-provider";
import { DisplayTimezoneBootstrap } from "@/lib/hooks/display-timezone-bootstrap";
import { WorkspaceThemeController } from "@/lib/hooks/workspace-theme";
import { WORKSPACE_THEME_INIT_SCRIPT } from "@/lib/theme-preference";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-next",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display-next",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
