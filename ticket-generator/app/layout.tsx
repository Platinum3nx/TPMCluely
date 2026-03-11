import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transcript → Tickets | Meeting Intelligence",
  description:
    "Transform raw meeting transcripts into actionable Linear-style engineering tickets using AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
