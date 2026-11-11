"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import { AccountMenu } from "@/components/account-menu";
import { UiIcon } from "@/components/ui-icon";
import { initialsOf, RequireSession, useSession } from "@/lib/session";

const navigation = [
  ["dashboard", "Resumen", "/dashboard"], ["files", "Mis archivos", "/archivos"],
  ["plans", "Planes", "/planes"], ["trash", "Papelera", "/papelera"],
  ["audit", "Auditoría", "/auditoria"], ["subscription", "Suscripción", "/suscripcion"], ["user", "Mi perfil", "/perfil"], ["storage", "Almacenamiento", "/almacenamiento"], ["settings", "Configuración", "/configuracion"],
] as const;

/** SPEC-502: anclas reales de la consola de plataforma (misma página). */
const adminNavigation = [
  ["dashboard", "Resumen global", "/dashboard/super-admin"], ["organizations", "Organizaciones", "/dashboard/super-admin#organizaciones"],
  ["install", "Instalaciones", "/dashboard/super-admin#instalaciones"],
] as const;

const roleLabels: Record<string, string> = { tenant_admin: "Administrador", owner: "Propietario", colaborador: "Colaborador", member: "Miembro", auditor: "Auditor" };

/**
 * Marco del espacio de trabajo. Exige sesión válida en el cliente (la API valida de nuevo cada request).
 * `requireSuperAdmin` (SPEC-502) oculta el contenido a quien no sea Super Admin y lo redirige a /dashboard.
 */
export function AppShell({ active, children, superAdmin = false, requireSuperAdmin = false }: { active: string; children: React.ReactNode; superAdmin?: boolean; requireSuperAdmin?: boolean }) {
  return <RequireSession>{(session) => <ShellFrame active={active} superAdmin={superAdmin} requireSuperAdmin={requireSuperAdmin} name={session.user.fullName} email={session.user.email} role={session.role}>{children}</ShellFrame>}</RequireSession>;
}

function ShellFrame({ active, children, superAdmin, requireSuperAdmin, name, email, role }: { active: string; children: React.ReactNode; superAdmin: boolean; requireSuperAdmin: boolean; name: string; email: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, signOut } = useSession();
  // Sesión sin Super Admin: se redirige. Sin sesión confirmada, RequireSession decide (login o sesión vencida).
  const wrongRole = requireSuperAdmin && session !== null && !session.isSuperAdmin;
  const notConfirmed = requireSuperAdmin && !session?.isSuperAdmin;
  useEffect(() => {
    if (wrongRole) router.replace("/dashboard");
  }, [wrongRole, router]);
  const initials = initialsOf(name);
  const items = superAdmin ? adminNavigation : navigation;
  const currentItem = items.find(([, , href]) => href === active || pathname.startsWith(`${href}/`));
  const currentLabel = currentItem?.[1] ?? (pathname.includes("archivos/") ? "Mis archivos" : "Espacio de trabajo");
  // Sin contenido hasta confirmar el permiso: no se pinta nada mientras se redirige.
  if (notConfirmed) return null;
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
      <main className="page-content">{children}</main>
    </div>
  </div>;
}
