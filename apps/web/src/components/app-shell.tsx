import Link from "next/link";
import { Brand } from "@/components/brand";

const navigation = [
  ["Resumen", "/dashboard"],
  ["Archivos", "/archivos"],
  ["Planes", "/planes"],
] as const;

export function AppShell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Navegación principal">
          {navigation.map(([label, href]) => (
            <Link key={href} href={href} aria-current={active === href ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span className="org-chip">Organización · pendiente de conectar con IAM</span>
          <Link className="muted" href="/login">Salir (pendiente)</Link>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
