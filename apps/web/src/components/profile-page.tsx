"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadingIndicator } from "@/components/toast";
import { UiIcon } from "@/components/ui-icon";
import { ApiError } from "@/lib/api/client";
import { changePassword, updateProfile } from "@/lib/api/iam";
import { initialsOf, useSession } from "@/lib/session";

const roleLabels: Record<string, string> = {
  tenant_admin: "Administrador",
  colaborador: "Colaborador",
  super_admin: "Superadministrador",
};

// Mismos límites que la API (SPEC-113 §3). Son ayuda para el usuario: la API es quien valida.
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 120;
const NAME_RULE_MESSAGE = "Revisa el nombre: entre 2 y 120 caracteres.";
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_RULE_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;
const PASSWORD_RULE_MESSAGE = "La nueva contraseña debe tener entre 8 y 128 caracteres, con letras y números.";
const WRONG_CURRENT_PASSWORD_MESSAGE = "La contraseña actual no es correcta.";
const GENERIC_ERROR_MESSAGE = "No fue posible guardar los cambios. Inténtalo de nuevo.";

type PasswordError = { field: "currentPassword" | "newPassword" | "form"; message: string };

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : GENERIC_ERROR_MESSAGE;
}

export function ProfilePage() {
  const { session, restoring, signOut } = useSession();
  const [passwordChanged, setPasswordChanged] = useState(false);

  async function handlePasswordChanged() {
    setPasswordChanged(true);
    // El servidor ya revocó las sesiones y limpió la cookie. signOut limpia el estado en memoria aunque la API no responda.
    await signOut();
  }

  // Fuera de AppShell: al limpiar la sesión, RequireSession redirigiría a /login y el mensaje no llegaría a verse.
  if (passwordChanged) return <main className="auth-layout">
    <section className="auth-form-card">
      <p className="notice" role="status">Tu contraseña se cambió. Inicia sesión de nuevo.</p>
      <p className="auth-switch"><Link href="/login">Ir a iniciar sesión</Link></p>
    </section>
  </main>;

  if (restoring) return <main className="auth-layout"><LoadingIndicator>Cargando perfil…</LoadingIndicator></main>;

  return <AppShell active="/perfil">
    {session && <>
      <div className="dashboard-page-heading profile-page-heading">
        <div><p className="eyebrow">CUENTA</p><h1>Mi perfil</h1><p>Consulta y actualiza la información de tu cuenta Nexus.</p></div>
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
          <NameForm accessToken={session.accessToken} fullName={session.user.fullName} />
          <dl className="profile-form">
            <div><dt>Correo electrónico</dt><dd>{session.user.email}</dd></div>
            <div><dt>Organización</dt><dd>{session.organization.name}</dd></div>
            <div><dt>Rol</dt><dd>{roleLabels[session.role] ?? session.role}</dd></div>
          </dl>
        </section>
        <section className="panel profile-panel profile-account-panel">
          <h2>Seguridad de la cuenta</h2>
          <PasswordForm accessToken={session.accessToken} onChanged={handlePasswordChanged} />
        </section>
      </div>
    </>}
  </AppShell>;
}

function NameForm({ accessToken, fullName }: { accessToken: string; fullName: string }) {
  const { failSession, updateSessionUser } = useSession();
  const [value, setValue] = useState(fullName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextName = value.trim();
    if (nextName.length < NAME_MIN_LENGTH || nextName.length > NAME_MAX_LENGTH) {
      setSaved(false);
      setError({ message: NAME_RULE_MESSAGE });
      return;
    }

    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const response = await updateProfile(accessToken, { fullName: nextName });
      updateSessionUser(response.user.fullName);
      setValue(response.user.fullName);
      setSaved(true);
    } catch (err) {
      if (failSession(err)) return;
      setError({ message: err instanceof ApiError && err.status === 400 ? NAME_RULE_MESSAGE : errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const describedBy = error ? "profile-full-name-help profile-full-name-error" : "profile-full-name-help";

  return <form className="profile-form" onSubmit={handleSubmit}>
    <div className="profile-field">
      <label htmlFor="profile-full-name">Nombre completo</label>
      <input
        id="profile-full-name"
        ref={inputRef}
        name="fullName"
        type="text"
        autoComplete="name"
        maxLength={NAME_MAX_LENGTH}
        required
        value={value}
        disabled={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => { setValue(event.target.value); setSaved(false); setError(null); }}
      />
      <small id="profile-full-name-help">Entre 2 y 120 caracteres.</small>
      {error && <p id="profile-full-name-error" className="auth-alert" role="alert">{error.message}</p>}
    </div>
    {saved && <p className="notice" role="status">Nombre actualizado.</p>}
    <div className="profile-form-actions">
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar nombre"}</button>
    </div>
  </form>;
}

function PasswordForm({ accessToken, onChanged }: { accessToken: string; onChanged: () => void }) {
  const { failSession } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PasswordError | null>(null);
  const currentInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error?.field === "currentPassword") currentInputRef.current?.focus();
    if (error?.field === "newPassword") newInputRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH || !PASSWORD_RULE_PATTERN.test(newPassword)) {
      setError({ field: "newPassword", message: PASSWORD_RULE_MESSAGE });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await changePassword(accessToken, { currentPassword, newPassword });
    } catch (err) {
      // SPEC-113 §8: 401 INVALID_CREDENTIALS es contraseña incorrecta, no sesión vencida. Se revisa antes de failSession.
      if (err instanceof ApiError && err.status === 401 && err.code === "INVALID_CREDENTIALS") {
        setError({ field: "currentPassword", message: WRONG_CURRENT_PASSWORD_MESSAGE });
        return;
      }
      if (failSession(err)) return;
      setError(err instanceof ApiError && err.status === 400
        ? { field: "newPassword", message: PASSWORD_RULE_MESSAGE }
        : { field: "form", message: errorMessage(err) });
      return;
    } finally {
      setBusy(false);
    }
    onChanged();
  }

  const currentError = error?.field === "currentPassword" ? error.message : null;
  const newError = error?.field === "newPassword" ? error.message : null;

  return <form className="profile-form" onSubmit={handleSubmit}>
    <div className="profile-field">
      <label htmlFor="profile-current-password">Contraseña actual</label>
      <input
        id="profile-current-password"
        ref={currentInputRef}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX_LENGTH}
        required
        value={currentPassword}
        disabled={busy}
        aria-invalid={currentError ? true : undefined}
        aria-describedby={currentError ? "profile-current-password-error" : undefined}
        onChange={(event) => { setCurrentPassword(event.target.value); setError(null); }}
      />
      {currentError && <p id="profile-current-password-error" className="auth-alert" role="alert">{currentError}</p>}
    </div>
    <div className="profile-field">
      <label htmlFor="profile-new-password">Contraseña nueva</label>
      <input
        id="profile-new-password"
        ref={newInputRef}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        required
        value={newPassword}
        disabled={busy}
        aria-invalid={newError ? true : undefined}
        aria-describedby={newError ? "profile-new-password-help profile-new-password-error" : "profile-new-password-help"}
        onChange={(event) => { setNewPassword(event.target.value); setError(null); }}
      />
      <small id="profile-new-password-help">Entre 8 y 128 caracteres, con letras y números.</small>
      {newError && <p id="profile-new-password-error" className="auth-alert" role="alert">{newError}</p>}
    </div>
    {error?.field === "form" && <p className="auth-alert" role="alert">{error.message}</p>}
    <div className="profile-form-actions">
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Cambiar contraseña"}</button>
    </div>
  </form>;
}
