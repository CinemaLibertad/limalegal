import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lima Legal | Gestión e investigación jurídica",
  description: "Una plataforma para organizar, investigar y coordinar el trabajo jurídico.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
