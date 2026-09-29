import Link from "next/link";
import { Brand } from "@/components/brand";
import { ScreenNote } from "@/components/screen-note";

export default function LoginPage() {
  return (
    <main className="auth-layout">
      <section className="auth-card">
        <Brand />
        <p className="eyebrow">Acceso</p>
        <h1 className="title">Iniciar sesión</h1>
        <p className="lead">Campos de preparación según el contrato propuesto. Ajustar textos, validaciones y acciones a Figma.</p>
        <ScreenNote />
        <div className="form-grid">
          <div className="field"><label htmlFor="email">Correo electrónico</label><input id="email" type="email" autoComplete="email" disabled /></div>
          <div className="field"><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" disabled /></div>
        </div>
        <div className="form-actions"><button className="button button-primary" type="button" disabled>Conectar al endpoint de IAM</button><Link className="button" href="/registro">Crear cuenta</Link></div>
        <p className="footer-note">La recuperación de contraseña forma parte del producto final; su vista y flujo deben mapearse al mockup correspondiente.</p>
      </section>
    </main>
  );
}
