import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProseMirror × SuperDocs Demo",
  description: "AI document editing via SuperDocs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
