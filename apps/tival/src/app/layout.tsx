import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tival — Oportunidades",
  description: "Sistema operativo comercial · playbooks, etapas y efectos",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
