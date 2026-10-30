"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { login, register, verifyEmail } from "@/lib/api/iam";
import { useSession } from "@/lib/session";
import { Brand } from "@/components/brand";
import { UiIcon } from "@/components/ui-icon";

function AuthLogo() {
  return <Link className="auth-logo-link" href="/" aria-label="Nexus, página principal"><Brand /></Link>;
}

function AuthFrame({ eyebrow, title, lead, children, className = "", simulated = false }: { eyebrow?: string; title: string; lead: string; children: React.ReactNode; className?: string; simulated?: boolean }) {
  return <main className="auth-layout"><section className={`auth-card auth-form-card ${className}`}><AuthLogo />{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 className="title">{title}</h1><p className="lead">{lead}</p>{children}{simulated && <p className="auth-demo-caption">Prototipo de interfaz · Esta pantalla aún no está conectada a la API; la información no se envía a un servidor.</p>}</section></main>;
}

function passwordIsStrong(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

function messageFor(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.code === "EMAIL_NOT_VERIFIED") return "Tu correo aún no está verificado. Revisa tu bandeja y abre el enlace que te enviamos.";
    if (error.status === 0) return error.message;
    if (error.status === 401) return "Correo o contraseña incorrectos. Verifica tus datos e inténtalo de nuevo.";
    if (error.status === 409) return "Este correo ya está registrado.";
    if (error.status === 429) return "Demasiados intentos. Inténtalo de nuevo más tarde.";
    if (error.status >= 500) return "Ocurrió un problema en el servidor. Inténtalo de nuevo en unos minutos.";
    return error.message || fallback;
  }
  return fallback;
}

export function LoginForm() {
  const router = useRouter();
  const { signIn } = useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Ingresa un correo electrónico válido."); return; }
    if (!password) { setError("Ingresa tu contraseña."); return; }

    setBusy(true); setError("");
    try {
      signIn(await login({ email, password }));
      router.push("/dashboard");
    } catch (err) {
      setError(messageFor(err, "No fue posible iniciar sesión."));
      setBusy(false);
    }
  }

  return <main className="login-screen">
    <section className="login-brand-pane" aria-label="Nexus, Nexo Digital">
      <div className="login-brand-lockup"><Image className="login-logo-img" src="/logo-nexus-oficial.svg" width={667} height={492} alt="Nexus, Nexo Digital" priority /><div className="brand-pagination" aria-hidden="true"><i /><i /><i /></div></div>
    </section>
    <section className="login-form-pane"><div className="login-card">
      <h1>Bienvenido</h1><p className="login-lead">Conéctate con tu espacio de trabajo digital y lleva tu productividad al siguiente nivel.</p>
      <form onSubmit={submit} noValidate>
        <div className="field login-field"><label htmlFor="login-email">Correo electrónico</label><input id="login-email" name="email" type="email" autoComplete="email" placeholder="Ejemplo@correo.com" required /></div>
        <div className="field login-field"><label htmlFor="login-password">Contraseña</label><input id="login-password" name="password" type="password" autoComplete="current-password" placeholder="Ingresa tu contraseña" required /></div>
        <div className="login-options"><label><input type="checkbox" name="remember" /> <span>Recuérdame</span></label><Link href="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link></div>
        {error && <div className="auth-alert" role="alert">{error}</div>}
        <button className="workspace-submit" type="submit" disabled={busy}>{busy ? "Ingresando…" : "Iniciar sesión"}</button>
      </form>
      <p className="workspace-register">¿No tienes una cuenta? <Link href="/registro">Registrarse</Link></p>
      <p className="workspace-security"><UiIcon name="shield" size={16} /> Tu sesión se valida en el servidor de Nexus</p>
    </div></section>
  </main>;
}

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const organization = String(form.get("organization") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (name.length < 2) { setError("Escribe tu nombre completo."); return; }
    if (organization.length < 2) { setError("Escribe el nombre de tu organización."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Ingresa un correo electrónico válido."); return; }
    if (!passwordIsStrong(password)) { setError("La contraseña es demasiado débil. Usa al menos 8 caracteres, una mayúscula y un número."); return; }
    if (password !== confirmation) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true); setError("");
    try {
      await register({ fullName: name, email, password, organizationName: organization });
      router.push(`/registro/completado?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(messageFor(err, "No fue posible crear la cuenta."));
      setBusy(false);
    }
  }
  return <AuthFrame className="register-card" title="Crea tu cuenta" lead="Comienza a guardar tus archivos de forma segura.">
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field"><label htmlFor="register-name">Nombre completo</label><input id="register-name" name="name" autoComplete="name" placeholder="Ej. Ana Martínez" required /></div>
      <div className="field"><label htmlFor="register-email">Correo electrónico</label><input id="register-email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required /></div>
      <div className="field"><label htmlFor="register-organization">Nombre de la organización</label><input id="register-organization" name="organization" autoComplete="organization" placeholder="Nombre de tu organización" required /></div>
      <div className="field"><label htmlFor="register-password">Contraseña</label><input id="register-password" name="password" type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" required /><small>Incluye una mayúscula y un número.</small></div>
      <div className="field"><label htmlFor="register-confirmation">Confirmar contraseña</label><input id="register-confirmation" name="confirmation" type="password" autoComplete="new-password" placeholder="Repite tu contraseña" required /></div>
      {error && <div className="auth-alert" role="alert">{error}</div>}
      <button className="button button-primary button-wide auth-submit" type="submit" disabled={busy}>{busy ? "Creando cuenta…" : "Crear cuenta"}</button>
    </form>
    <p className="auth-switch">¿Ya tienes una cuenta? <Link href="/login">Iniciar sesión</Link></p>
  </AuthFrame>;
}

export function RegistrationComplete() {
  return <AuthFrame className="auth-result-card" title="Cuenta creada" lead="Tu registro se completó correctamente.">
    <div className="auth-result-icon" aria-hidden="true"><UiIcon name="envelope" size={25} /></div>
    <div className="auth-result-notice"><strong>Tu cuenta está pendiente de verificar</strong><span>Revisa tu correo electrónico y abre el enlace que te enviamos. Vence en 15 minutos y solo sirve una vez.</span></div>
    <Link className="button button-primary button-wide auth-submit" href="/verificar-correo">Ya tengo mi enlace o código</Link>
    <p className="auth-switch"><Link href="/login">Volver al inicio de sesión</Link></p>
  </AuthFrame>;
}

export function VerifyForm() {
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");

  async function confirm(value: string) {
    const clean = value.trim();
    if (clean.length < 20) { setStatus("El enlace o código no es válido. Copia el enlace completo del correo."); return; }
    setBusy(true); setStatus("");
    try {
      await verifyEmail(clean);
      setDone(true);
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 0 ? err.message : "El enlace venció o ya fue usado. Inicia sesión para revisar el estado de tu cuenta o crea una cuenta nueva.");
    } finally { setBusy(false); }
  }

useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("token");
    if (fromLink) {
      queueMicrotask(() => {
        setToken(fromLink);
        void confirm(fromLink);
      });
    }
  }, []);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void confirm(token);
  }
  return <AuthFrame className="auth-result-card" title={done ? "Correo verificado" : "Verifica tu correo"} lead={done ? "Tu cuenta está lista. Ya puedes iniciar sesión." : "Abre el enlace que enviamos a tu correo o pega aquí el código del enlace."}>
    <div className="auth-result-icon" aria-hidden="true"><UiIcon name={done ? "check" : "envelope"} size={25} /></div>
    {done ? <Link className="button button-primary button-wide auth-submit" href="/login">Iniciar sesión</Link> : <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field"><label htmlFor="verify-code">Código de verificación</label><input id="verify-code" name="code" autoComplete="one-time-code" placeholder="Pega el código del enlace" value={token} onChange={(event) => setToken(event.target.value)} required /></div>
      {status && <div className="auth-alert" role="alert">{status}</div>}
      <button className="button button-primary button-wide auth-submit" type="submit" disabled={busy}>{busy ? "Verificando…" : "Verificar correo"}</button>
      <p className="auth-demo-hint">El reenvío del enlace aún no forma parte del contrato de la API.</p>
    </form>}
    <p className="auth-switch"><Link href="/registro">Usar otra cuenta</Link></p>
  </AuthFrame>;
}

export function RecoverForm() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setEmail(String(new FormData(e.currentTarget).get("email") ?? "")); setSent(true); }
  return <AuthFrame className="auth-result-card" title={sent ? "Revisa tu correo" : "Recupera tu contraseña"} simulated lead={sent ? `Si existe una cuenta para ${email}, recibirás instrucciones para restablecer tu contraseña.` : "Ingresa el correo asociado a tu cuenta y te enviaremos instrucciones para restablecerla."}>
    {sent ? <><div className="auth-result-icon" aria-hidden="true"><UiIcon name="envelope" size={25} /></div><div className="auth-result-notice"><strong>Solicitud registrada</strong><span>Esta confirmación es simulada; no se envió ningún correo.</span></div><Link className="button button-primary button-wide auth-submit" href="/nueva-contrasena">Abrir nueva contraseña (demo)</Link><button className="text-button auth-resend-button" onClick={() => setSent(false)}>Usar otro correo</button></> : <form className="auth-form" onSubmit={submit}>
      <div className="field"><label htmlFor="recover-email">Correo electrónico</label><input id="recover-email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required /></div>
      <button className="button button-primary button-wide auth-submit" type="submit">Enviar instrucciones</button>
    </form>}
    <p className="auth-switch"><Link href="/login"><UiIcon name="arrowLeft" size={15} /> Volver a iniciar sesión</Link></p>
  </AuthFrame>;
}

export function NewPasswordForm() {
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (expired) { setError("El enlace de recuperación venció. Solicita uno nuevo para continuar."); return; }
    if (!passwordIsStrong(password)) { setError("La contraseña es demasiado débil. Usa 8 caracteres, una mayúscula y un número."); return; }
    if (password !== confirmation) { setError("Las contraseñas no coinciden."); return; }
    setDone(true); setError("");
  }
  return <AuthFrame simulated className="auth-result-card" title={expired ? "Enlace vencido" : done ? "Contraseña actualizada" : "Crea una nueva contraseña"} lead={expired ? "El enlace ya no es válido. Solicita uno nuevo para proteger tu cuenta." : done ? "Tu contraseña se cambió correctamente." : "Elige una contraseña segura para volver a acceder a tu cuenta."}>
    {expired ? <><div className="auth-alert" role="alert">El enlace de recuperación venció.</div><Link className="button button-primary button-wide auth-submit" href="/recuperar-contrasena">Solicitar otro enlace</Link></> : done ? <><div className="auth-result-icon" aria-hidden="true"><UiIcon name="check" size={25} /></div><Link className="button button-primary button-wide auth-submit" href="/login">Ir al inicio de sesión</Link></> : <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field"><label htmlFor="new-password">Contraseña nueva</label><input id="new-password" name="password" type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" required /><small>Incluye una mayúscula y un número.</small></div>
      <div className="field"><label htmlFor="new-password-confirm">Confirmar contraseña</label><input id="new-password-confirm" name="confirmation" type="password" autoComplete="new-password" placeholder="Repite tu contraseña" required /></div>
      {error && <div className="auth-alert" role="alert">{error}</div>}
      <button className="button button-primary button-wide auth-submit" type="submit">Cambiar contraseña</button>
      <button type="button" className="text-button auth-demo-expired" onClick={() => { setExpired(true); setError(""); }}>Probar enlace vencido</button>
    </form>}
    <p className="auth-switch"><Link href="/login">Volver al inicio de sesión</Link></p>
  </AuthFrame>;
}

export function SessionExpired() {
  return <AuthFrame className="auth-result-card" title="Tu sesión venció" lead="Por seguridad, tu sesión terminó. Inicia sesión nuevamente para continuar.">
    <div className="auth-result-icon" aria-hidden="true"><UiIcon name="shield" size={25} /></div>
    <Link className="button button-primary button-wide auth-submit" href="/login">Iniciar sesión nuevamente</Link>
    <p className="auth-switch"><Link href="/">Volver al sitio de Nexus</Link></p>
  </AuthFrame>;
}
