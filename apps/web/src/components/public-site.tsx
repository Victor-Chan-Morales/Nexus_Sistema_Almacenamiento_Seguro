import Link from "next/link";
import { NexusMark } from "@/components/brand";

function PublicLogo() {
  return <NexusMark className="public-logo-crop" priority />;
}

export function PublicHeader() {
  return <header className="public-header"><Link href="/" className="public-brand" aria-label="Nexus, página principal"><PublicLogo /></Link><nav className="public-nav" aria-label="Navegación pública"><Link href="/">Principal</Link><Link href="/servicios">Servicios</Link><Link href="/#beneficios">Sobre nosotros</Link><Link href="/contacto">Contacto</Link></nav><div className="public-header-actions"><Link className="public-login-link" href="/login">Ingresar</Link><Link className="button button-primary public-header-cta" href="/registro">Crear cuenta</Link></div></header>;
}

export function PublicFooter() {
  return <footer className="public-footer"><div className="public-footer-main"><div className="public-footer-about"><Link href="/" className="public-brand" aria-label="Nexus, página principal"><PublicLogo /></Link><p>Almacenamiento seguro y flexible para los archivos de tu organización.</p></div><div><h3>Productos</h3><Link href="/servicios">Servicios</Link><Link href="/planes">Planes</Link><Link href="/#seguridad">Seguridad</Link></div><div><h3>Recursos</h3><Link href="/contacto">Solicitar información</Link><Link href="/login">Acceso a espacios</Link></div><div><h3>Nexus</h3><Link href="/#beneficios">Beneficios</Link><Link href="/registro">Crear una cuenta</Link></div></div><div className="public-footer-bottom"><span>© 2026 Nexus · Nexo Digital</span><span>Almacenamiento seguro para organizaciones</span></div></footer>;
}

export function StorageIllustration() {
  return <div className="storage-illustration" aria-label="Ilustración de almacenamiento en la nube, servidores locales y dispositivos">
    <div className="illustration-orbit orbit-one" /><div className="illustration-orbit orbit-two" />
    <div className="storage-cloud"><svg viewBox="0 0 220 150" aria-hidden="true"><path d="M51 121h115a37 37 0 0 0 4-74 57 57 0 0 0-108-8 42 42 0 0 0-11 82Z" fill="#f9fbff"/><path d="M110 95V55m0 0-16 16m16-16 16 16" fill="none" stroke="#5848a4" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
    <div className="storage-laptop"><div className="laptop-screen"><div className="screen-bar"/><div className="screen-row"><i/><span/></div><div className="screen-row"><i/><span/></div><div className="screen-row"><i/><span/></div></div><div className="laptop-base"/></div>
    <div className="storage-server"><i/><i/><i/></div><div className="storage-phone"><div/><i/><i/></div>
    <svg className="storage-connections" viewBox="0 0 520 390" aria-hidden="true"><path d="M124 120 188 170 302 122 365 175M92 219 164 254 288 223 380 265M225 202v49m82-128v42" fill="none" stroke="#63d5de" strokeWidth="3" strokeDasharray="7 8"/><circle cx="188" cy="170" r="5" fill="#ff8495"/><circle cx="365" cy="175" r="5" fill="#ff8495"/><circle cx="288" cy="223" r="5" fill="#ff8495"/></svg>
    <span className="illustration-label label-cloud">CLOUD</span><span className="illustration-label label-local">LOCAL</span>
  </div>;
}

export function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return <div className="public-section-heading"><span>{eyebrow}</span><h2>{title}</h2>{text && <p>{text}</p>}</div>;
}
