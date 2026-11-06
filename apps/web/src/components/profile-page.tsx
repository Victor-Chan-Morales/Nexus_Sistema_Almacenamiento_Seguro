"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LoadingIndicator } from "@/components/toast";
import { UiIcon } from "@/components/ui-icon";
import { initialsOf, useSession } from "@/lib/session";

const roleLabels: Record<string, string> = {
  tenant_admin: "Administrador",
  colaborador: "Colaborador",
  super_admin: "Superadministrador",
};

export function ProfilePage() {
  const { session, restoring } = useSession();
  if (restoring) return <main className="auth-layout"><LoadingIndicator>Cargando perfil…</LoadingIndicator></main>;

  return <AppShell active="/perfil">
    {session && <>
      <div className="dashboard-page-heading profile-page-heading">
        <div><p className="eyebrow">CUENTA</p><h1>Mi perfil</h1><p>Consulta la información de tu cuenta Nexus.</p></div>
      </div>
      <section className="panel profile-summary">
        <span className="profile-avatar" aria-hidden="true">{initialsOf(session.user.fullName) || <UiIcon name="user" size={28} />}</span>
        <div className="profile-summary-copy">
          <h2>{session.user.fullName}</h2>
          <p>{session.organization.name}</p>
        </div>
      </section>
      <div className="profile-content-grid">
        <section className="panel profile-panel">
          <h2>Información personal</h2>
          <dl className="profile-form">
            <div><dt>Nombre completo</dt><dd>{session.user.fullName}</dd></div>
            <div><dt>Correo electrónico</dt><dd>{session.user.email}</dd></div>
            <div><dt>Organización</dt><dd>{session.organization.name}</dd></div>
            <div><dt>Rol</dt><dd>{roleLabels[session.role] ?? session.role}</dd></div>
          </dl>
        </section>
        <section className="panel profile-panel profile-account-panel">
          <h2>Seguridad de la cuenta</h2>
          <div className="profile-account-row"><b>Contraseña</b><Link href="/recuperar-contrasena">Cambiar</Link></div>
        </section>
      </div>
    </>}
  </AppShell>;
}
