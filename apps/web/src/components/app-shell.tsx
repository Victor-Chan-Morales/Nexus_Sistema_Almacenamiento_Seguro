"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import { AccountMenu } from "@/components/account-menu";
import { DemoBanner } from "@/components/demo-banner";
import { UiIcon } from "@/components/ui-icon";
import { initialsOf, RequireSession, useSession } from "@/lib/session";

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

const roleLabels: Record<string, string> = { tenant_admin: "Administrador", owner: "Propietario", colaborador: "Colaborador", member: "Miembro", auditor: "Auditor" };

/**
 * Marco del espacio de trabajo. Exige sesión válida en el cliente (la API valida de nuevo cada request).
 * `demo` solo se activa en pantallas que todavía no consumen la API.
 */
export function AppShell({ active, children, superAdmin = false, demo = false }: { active: string; children: React.ReactNode; superAdmin?: boolean; demo?: boolean }) {
  return <RequireSession>{(session) => <ShellFrame active={active} superAdmin={superAdmin} demo={demo} name={session.user.fullName} email={session.user.email} organization={session.organization.name} role={session.role}>{children}</ShellFrame>}</RequireSession>;
}

function ShellFrame({ active, children, superAdmin, demo, name, email, organization, role }: { active: string; children: React.ReactNode; superAdmin: boolean; demo: boolean; name: string; email: string; organization: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useSession();
  const initials = initialsOf(name);
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
      <div className="sidebar-bottom"><Link href="/perfil" className="sidebar-account-link" aria-label="Ver mi perfil"><span className="avatar">{initials}</span><span><strong>{name}</strong><small>{roleLabels[role] ?? role}</small></span></Link><button className="icon-button" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={async () => { await signOut(); router.push("/login"); }}><UiIcon name="logout" size={17} /></button></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb">Nexus <span>/</span> {currentLabel}</div><div className="top-actions"><button className="icon-button" aria-label="Notificaciones"><UiIcon name="notifications" size={18} /><i /></button><AccountMenu name={name} email={email} /></div></header>
      {demo && <DemoBanner />}
      <main className="page-content">{children}</main>
    </div>
  </div>;
}
