"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { DemoBanner } from "@/components/demo-banner";
import { UiIcon } from "@/components/ui-icon";
import { DEMO_EVENT, DemoState, readDemo } from "@/lib/demo";

const navigation = [
  ["dashboard", "Resumen", "/dashboard"], ["files", "Mis archivos", "/archivos"],
  ["plans", "Planes", "/planes"], ["trash", "Papelera", "/papelera"],
  ["audit", "Auditoría", "/auditoria"], ["subscription", "Suscripción", "/suscripcion"], ["user", "Mi perfil", "/perfil"], ["settings", "Configuración", "/configuracion"],
] as const;

const adminNavigation = [
  ["dashboard", "Resumen global", "/dashboard/super-admin"], ["organizations", "Organizaciones", "/dashboard/super-admin#organizaciones"],
  ["plans", "Planes", "/dashboard/super-admin#planes"], ["install", "Instalaciones", "/dashboard/super-admin#instalaciones"],
  ["activity", "Actividad global", "/dashboard/super-admin#actividad"],
] as const;

export function AppShell({ active, children, superAdmin = false }: { active: string; children: React.ReactNode; superAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [demo, setDemo] = useState<DemoState | null>(null);
  useEffect(() => { const update = () => setDemo(readDemo()); update(); window.addEventListener(DEMO_EVENT, update); window.addEventListener("storage", update); return () => { window.removeEventListener(DEMO_EVENT, update); window.removeEventListener("storage", update); }; }, []);
  const name = demo?.user.name ?? "Ana Martínez";
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const items = superAdmin ? adminNavigation : navigation;
  const currentItem = items.find(([, , href]) => href === active || pathname.startsWith(`${href}/`));
  const currentLabel = currentItem?.[1] ?? (pathname.includes("archivos/") ? "Mis archivos" : "Espacio de trabajo");
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand-link"><Brand /></Link>
      <p className="nav-caption">{superAdmin ? "ADMINISTRACIÓN DE PLATAFORMA" : "ESPACIO DE TRABAJO"}</p>
      <nav className="side-nav" aria-label="Navegación principal">
        {items.map(([icon, label, href]) => <Link key={href} href={href} aria-current={active === href || pathname.startsWith(`${href}/`) ? "page" : undefined}><span className="nav-icon"><UiIcon name={icon} size={17} /></span>{label}</Link>)}
      </nav>
      <div className="sidebar-bottom"><Link href="/perfil" className="sidebar-account-link" aria-label="Ver mi perfil"><span className="avatar">{initials}</span><span><strong>{name}</strong><small>{superAdmin ? "Super Admin · demostración" : "Administradora"}</small></span></Link><button className="icon-button" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => { sessionStorage.removeItem("nexus-demo-session"); router.push("/login"); }}><UiIcon name="logout" size={17} /></button></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb">Nexus <span>/</span> {currentLabel}</div><div className="top-actions"><button className="icon-button" aria-label="Notificaciones"><UiIcon name="notifications" size={18} /><i /></button>{superAdmin ? <span className="org-chip"><span className="org-avatar">N</span> Consola global</span> : <span className="org-chip"><span className="org-avatar">{(demo?.user.organization ?? "Acme Guatemala").charAt(0).toUpperCase()}</span> {demo?.user.organization ?? "Acme Guatemala"} <span className="chevron"><UiIcon name="chevron" size={13} /></span></span>}</div></header>
      <DemoBanner />
      <main className="page-content">{children}</main>
    </div>
  </div>;
}
