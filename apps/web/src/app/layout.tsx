import type { Metadata } from "next";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus | Almacenamiento seguro",
  description: "Base de interfaz para la plataforma Nexus de almacenamiento seguro híbrido.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
