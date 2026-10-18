import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/bottom-nav";
import { strings } from "@/lib/strings";
import "./globals.css";

export const metadata: Metadata = {
  title: strings.app.name,
  description: strings.app.description,
  applicationName: strings.app.name,
  appleWebApp: { capable: true, title: strings.app.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh flex-col bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 antialiased">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
