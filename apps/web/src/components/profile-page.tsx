"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { DEMO_EVENT, DemoState, initialDemo, readDemo, writeDemo } from "@/lib/demo";

export function ProfilePage() {
  const [state, setState] = useState<DemoState>(initialDemo);
  const [name, setName] = useState(initialDemo.user.name);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const update = () => {
      const current = readDemo();
      setState(current);
      setName(current.user.name);
    };
    update();
    window.addEventListener(DEMO_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(DEMO_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);

  const initials = state.user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const next = { ...state, user: { ...state.user, name: cleanName } };
    writeDemo(next);
    setState(next);
    setName(cleanName);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3500);
  }

  return <AppShell active="/perfil">
    <div className="dashboard-page-heading profile-page-heading">
      <div><p className="eyebrow">CUENTA</p><h1>Mi perfil</h1><p>Consulta y actualiza la información de tu cuenta Nexus.</p></div>
    </div>

    <section className="panel profile-summary">
      <span className="profile-avatar">{initials || <UiIcon name="user" size={28} />}</span>
      <div className="profile-summary-copy"><span className="profile-overline">PERFIL PERSONAL</span><h2>{state.user.name}</h2><p>{state.user.organization}</p></div>
      <span className={`profile-verified ${state.verified ? "is-verified" : "is-pending"}`}><UiIcon name={state.verified ? "check" : "info"} size={14} />{state.verified ? "Correo verificado" : "Verificación pendiente"}</span>
    </section>

    <div className="profile-content-grid">
      <section className="panel profile-panel">
        <div className="profile-section-heading"><span className="profile-section-icon"><UiIcon name="user" size={18} /></span><div><h2>Información personal</h2><p>Estos datos identifican tu cuenta dentro de la organización.</p></div></div>
        <form className="profile-form" onSubmit={saveProfile}>
          <label className="profile-field" htmlFor="profile-name"><span>Nombre completo</span><input id="profile-name" name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /><small>Este nombre aparecerá junto a tus archivos y actividades.</small></label>
          <label className="profile-field" htmlFor="profile-email"><span>Correo electrónico</span><span className="profile-input-with-icon"><UiIcon name="mail" size={16} /><input id="profile-email" type="email" value={state.user.email} readOnly aria-describedby="profile-email-note" /></span><small id="profile-email-note">El correo se usa para iniciar sesión y no se puede cambiar desde esta pantalla.</small></label>
          {saved && <p className="profile-save-success" role="status"><UiIcon name="check" size={15} />Cambios guardados en esta demostración.</p>}
          <div className="profile-form-actions"><button className="button button-primary" type="submit">Guardar cambios</button></div>
        </form>
      </section>

      <aside className="profile-side-column">
        <section className="panel profile-panel profile-account-panel"><div className="profile-section-heading"><span className="profile-section-icon blue-bg"><UiIcon name="shield" size={18} /></span><div><h2>Seguridad de la cuenta</h2><p>Mantén protegidas tus credenciales.</p></div></div><div className="profile-account-row"><span><b>Contraseña</b><small>Actualiza tu contraseña periódicamente.</small></span><Link href="/recuperar-contrasena">Cambiar</Link></div><p className="profile-demo-note">La actualización de credenciales se completará al conectar el servicio de identidad.</p></section>
        <section className="panel profile-panel profile-org-panel"><div className="profile-section-heading"><span className="profile-section-icon coral-bg"><UiIcon name="organizations" size={18} /></span><div><h2>Organización</h2><p>Espacio de trabajo asociado.</p></div></div><div className="profile-org-value"><span className="org-avatar">{state.user.organization.charAt(0).toUpperCase()}</span><span><b>{state.user.organization}</b><small>Cuenta de demostración</small></span></div></section>
      </aside>
    </div>
    <p className="profile-demo-note profile-page-note">Los cambios de esta pantalla se guardan únicamente en los datos locales de demostración.</p>
  </AppShell>;
}
