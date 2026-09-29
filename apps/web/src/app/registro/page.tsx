import Link from "next/link";
import { Brand } from "@/components/brand";
import { ScreenNote } from "@/components/screen-note";

export default function RegisterPage() {
  return (
    <main className="auth-layout">
      <section className="auth-card">
        <Brand />
        <p className="eyebrow">Registro</p>
        <h1 className="title">Crear organización</h1>
        <p className="lead">La cuenta inicial recibirá el rol de administración del tenant, sujeto a la regla aprobada por el equipo.</p>
        <ScreenNote />
        <div className="form-grid">
          <div className="field"><label htmlFor="fullName">Nombre completo</label><input id="fullName" autoComplete="name" disabled /></div>
          <div className="field"><label htmlFor="email">Correo electrónico</label><input id="email" type="email" autoComplete="email" disabled /></div>
          <div className="field"><label htmlFor="orgName">Nombre de organización</label><input id="orgName" autoComplete="organization" disabled /></div>
          <div className="field"><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="new-password" disabled /></div>
        </div>
        <div className="form-actions"><button className="button button-primary" type="button" disabled>Conectar al endpoint de IAM</button><Link className="button" href="/login">Ya tengo cuenta</Link></div>
      </section>
    </main>
  );
}
