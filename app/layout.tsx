import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forklore.ai - Reddit's Best Restaurants",
  description: "Discover the most loved restaurants on Reddit, ranked by the crowd and refined by data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-black text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
