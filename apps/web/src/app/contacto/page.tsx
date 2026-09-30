import Link from "next/link";
import { ContactForm } from "@/components/contact-form";
import { PublicFooter, PublicHeader } from "@/components/public-site";

export default function ContactPage() {
  return <main className="public-site"><PublicHeader /><section className="contact-hero"><div><span className="public-kicker">ESTAMOS PARA AYUDARTE</span><h1>Hablemos de la información de tu organización</h1><p>Solicita detalles sobre Nexus, sus opciones de almacenamiento y los planes de referencia.</p><div className="contact-back-links"><Link href="/servicios">Ver servicios</Link><Link href="/planes">Consultar planes</Link></div></div><div className="contact-orbit" aria-hidden="true"><span>NX</span><i>↗</i><i>◈</i></div></section><section className="contact-main"><ContactForm /><aside className="contact-aside"><span className="contact-aside-icon">◈</span><h2>Explora Nexus</h2><p>Revisa los servicios y el catálogo de planes de referencia antes de solicitar información.</p><Link href="/servicios">Conocer servicios →</Link><Link href="/planes">Ver planes →</Link><div className="contact-aside-note">Las capacidades y condiciones comerciales se confirman con el equipo Nexus.</div></aside></section><PublicFooter /></main>;
}
