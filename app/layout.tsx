import type { Metadata, Viewport } from "next";
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
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh flex-col bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
