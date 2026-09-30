"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { initialDemo, readDemo, writeDemo, DEMO_SESSION } from "@/lib/demo";
import { NexusMark } from "@/components/brand";
import { UiIcon } from "@/components/ui-icon";

function AuthLogo() {
  return <Link className="auth-logo-link" href="/" aria-label="Nexus, página principal"><NexusMark priority /></Link>;
}

function AuthFrame({ eyebrow, title, lead, children, className = "" }: { eyebrow?: string; title: string; lead: string; children: React.ReactNode; className?: string }) {
  return <main className="auth-layout"><section className={`auth-card auth-form-card ${className}`}><AuthLogo />{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 className="title">{title}</h1><p className="lead">{lead}</p>{children}<p className="auth-demo-caption">Prototipo de interfaz · La información no se envía a un servidor.</p></section></main>;
}

function passwordIsStrong(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const state = readDemo();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Ingresa un correo electrónico válido."); return; }
    if (email === "bloqueada@nexus.demo") { setError("Esta cuenta está bloqueada. Contacta al administrador de tu organización."); return; }
    if (email === "pendiente@nexus.demo" || (email === state.user.email.toLowerCase() && !state.verified)) { setError("Tu correo aún no está verificado. Revisa tu bandeja o solicita otro código."); return; }
    if (email !== state.user.email.toLowerCase() && email !== "ana@nexus.demo") { setError("No encontramos una cuenta asociada a este correo."); return; }
    if (password.length < 8 || password.toLowerCase() === "incorrecta") { setError("La contraseña no es correcta. Verifica tus datos e inténtalo de nuevo."); return; }

    state.user.email = email;
    writeDemo(state);
    sessionStorage.setItem(DEMO_SESSION, "demo");
    router.push("/dashboard");
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
        <button className="workspace-submit" type="submit">Iniciar sesión</button>
      </form>
      <p className="workspace-register">¿No tienes una cuenta? <Link href="/registro">Registrarse</Link></p>
      <p className="workspace-security"><UiIcon name="shield" size={16} /> Acceso de demostración · No uses una contraseña real</p>
      <div className="login-demo-cases">Para probar estados: <code>bloqueada@nexus.demo</code>, <code>pendiente@nexus.demo</code>, un correo inexistente o la contraseña <code>incorrecta</code>.</div>
    </div></section>
  </main>;
}

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const organization = String(form.get("organization") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Ingresa un correo electrónico válido."); return; }
    if (!passwordIsStrong(password)) { setError("La contraseña es demasiado débil. Usa al menos 8 caracteres, una mayúscula y un número."); return; }
    if (password !== confirmation) { setError("Las contraseñas no coinciden."); return; }
    if (email === readDemo().user.email.toLowerCase()) { setError("Este correo ya está registrado."); return; }
    writeDemo({ ...initialDemo, user: { name, email, organization }, verified: false });
    router.push(`/registro/completado?email=${encodeURIComponent(email)}`);
  }
  return <AuthFrame className="register-card" title="Crea tu cuenta" lead="Comienza a guardar tus archivos de forma segura.">
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field"><label htmlFor="register-name">Nombre completo</label><input id="register-name" name="name" autoComplete="name" placeholder="Ej. Ana Martínez" required /></div>
      <div className="field"><label htmlFor="register-email">Correo electrónico</label><input id="register-email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required /></div>
      <div className="field"><label htmlFor="register-organization">Nombre de la organización</label><input id="register-organization" name="organization" autoComplete="organization" placeholder="Nombre de tu organización" required /></div>
      <div className="field"><label htmlFor="register-password">Contraseña</label><input id="register-password" name="password" type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" required /><small>Incluye una mayúscula y un número.</small></div>
      <div className="field"><label htmlFor="register-confirmation">Confirmar contraseña</label><input id="register-confirmation" name="confirmation" type="password" autoComplete="new-password" placeholder="Repite tu contraseña" required /></div>
      {error && <div className="auth-alert" role="alert">{error}</div>}
      <button className="button button-primary button-wide auth-submit" type="submit">Crear cuenta</button>
    </form>
    <p className="auth-switch">¿Ya tienes una cuenta? <Link href="/login">Iniciar sesión</Link></p>
  </AuthFrame>;
}

export function RegistrationComplete() {
  return <AuthFrame className="auth-result-card" title="Cuenta creada" lead="Tu registro se completó correctamente.">
    <div className="auth-result-icon" aria-hidden="true">✉</div>
    <div className="auth-result-notice"><strong>Tu cuenta está pendiente de verificar</strong><span>Revisa tu correo electrónico y abre el enlace o ingresa el código que te enviamos.</span></div>
    <Link className="button button-primary button-wide auth-submit" href="/verificar-correo">Continuar a la verificación</Link>
    <p className="auth-switch"><Link href="/login">Volver al inicio de sesión</Link></p>
  </AuthFrame>;
}

export function VerifyForm() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState(initialDemo.user.email);
  useEffect(() => { setEmail(readDemo().user.email); }, []);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    if (code !== "123456") { setStatus("El código venció o no es válido. Solicita uno nuevo y vuelve a intentarlo."); return; }
    const state = readDemo(); state.verified = true; writeDemo(state); setDone(true); setStatus("");
  }
  return <AuthFrame className="auth-result-card" title={done ? "Correo verificado" : "Verifica tu correo"} lead={done ? "Tu cuenta está lista. Ya puedes iniciar sesión." : "Ingresa el código de verificación que enviamos a tu correo electrónico."}>
    <div className="auth-result-icon" aria-hidden="true">{done ? "✓" : "✉"}</div>
    {done ? <Link className="button button-primary button-wide auth-submit" href="/login">Iniciar sesión</Link> : <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field"><label htmlFor="verify-email">Correo electrónico</label><input id="verify-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div className="field"><label htmlFor="verify-code">Código de verificación</label><input id="verify-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Ingresa tu código" required /></div>
      {status && <div className="auth-alert" role="alert">{status}</div>}
      <button className="button button-primary button-wide auth-submit" type="submit">Verificar correo</button>
      <p className="auth-resend">¿No recibiste el código? <button type="button" onClick={() => setStatus("Código reenviado (simulación). Usa 123456 para completar la verificación.")}>Reenviar código</button></p>
      <p className="auth-demo-hint">Demo: código válido <code>123456</code>. Otro código simula un token inválido o vencido.</p>
    </form>}
    {done && <p className="auth-switch"><button className="text-button" onClick={() => router.push("/dashboard")}>Ir al espacio de trabajo</button></p>}
    <p className="auth-switch"><Link href="/registro">Usar otra cuenta</Link></p>
  </AuthFrame>;
}

export function RecoverForm() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setEmail(String(new FormData(e.currentTarget).get("email") ?? "")); setSent(true); }
  return <AuthFrame className="auth-result-card" title={sent ? "Revisa tu correo" : "Recupera tu contraseña"} lead={sent ? `Si existe una cuenta para ${email}, recibirás instrucciones para restablecer tu contraseña.` : "Ingresa el correo asociado a tu cuenta y te enviaremos instrucciones para restablecerla."}>
    {sent ? <><div className="auth-result-icon" aria-hidden="true">✉</div><div className="auth-result-notice"><strong>Solicitud registrada</strong><span>Esta confirmación es simulada; no se envió ningún correo.</span></div><Link className="button button-primary button-wide auth-submit" href="/nueva-contrasena">Abrir nueva contraseña (demo)</Link><button className="text-button auth-resend-button" onClick={() => setSent(false)}>Usar otro correo</button></> : <form className="auth-form" onSubmit={submit}>
      <div className="field"><label htmlFor="recover-email">Correo electrónico</label><input id="recover-email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required /></div>
      <button className="button button-primary button-wide auth-submit" type="submit">Enviar instrucciones</button>
    </form>}
    <p className="auth-switch"><Link href="/login">← Volver a iniciar sesión</Link></p>
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
  return <AuthFrame className="auth-result-card" title={expired ? "Enlace vencido" : done ? "Contraseña actualizada" : "Crea una nueva contraseña"} lead={expired ? "El enlace ya no es válido. Solicita uno nuevo para proteger tu cuenta." : done ? "Tu contraseña se cambió correctamente." : "Elige una contraseña segura para volver a acceder a tu cuenta."}>
    {expired ? <><div className="auth-alert" role="alert">El enlace de recuperación venció.</div><Link className="button button-primary button-wide auth-submit" href="/recuperar-contrasena">Solicitar otro enlace</Link></> : done ? <><div className="auth-result-icon" aria-hidden="true">✓</div><Link className="button button-primary button-wide auth-submit" href="/login">Ir al inicio de sesión</Link></> : <form className="auth-form" onSubmit={submit} noValidate>
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
    <div className="auth-result-icon" aria-hidden="true">⌑</div>
    <Link className="button button-primary button-wide auth-submit" href="/login">Iniciar sesión nuevamente</Link>
    <p className="auth-switch"><Link href="/">Volver al sitio de Nexus</Link></p>
  </AuthFrame>;
}
