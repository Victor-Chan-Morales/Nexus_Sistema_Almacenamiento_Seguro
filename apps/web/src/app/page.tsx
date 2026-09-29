import Link from "next/link";
import { Brand } from "@/components/brand";

const routes = [
  ["Iniciar sesión", "/login"],
  ["Crear cuenta", "/registro"],
  ["Planes", "/planes"],
  ["Dashboard", "/dashboard"],
  ["Archivos", "/archivos"],
] as const;

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing-card">
        <Brand />
        <p className="eyebrow">Base de interfaz · corte inicial</p>
        <h1 className="title">Nexus, almacenamiento seguro para organizaciones</h1>
        <p className="lead">Rutas y componentes listos para que Víctor implemente las pantallas del equipo a partir de los mockups aprobados.</p>
        <p className="notice">Los frames de Figma aún deben vincularse en <code>docs/FIGMA_MAP.md</code>. Esta página es un índice de desarrollo, no una pantalla final del producto.</p>
        <nav className="route-list" aria-label="Rutas disponibles">
          {routes.map(([label, href]) => <Link className="route-link" key={href} href={href}>{label}</Link>)}
        </nav>
        <p className="footer-note">Las llamadas a API, persistencia y autenticación todavía no están implementadas.</p>
      </section>
    </main>
  );
}
