import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "AK-DRIP — Agent",
  description: "AI agent that writes personalized emails and pushes leads into Drip",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
