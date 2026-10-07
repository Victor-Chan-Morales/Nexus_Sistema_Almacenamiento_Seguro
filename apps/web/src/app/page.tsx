import Link from "next/link";
import { PublicFooter, PublicHeader, SectionHeading, StorageIllustration } from "@/components/public-site";
import { UiIcon } from "@/components/ui-icon";
import { getPlan } from "@/lib/plans";

const benefits = [
  { icon: "shield", title: "Control de tu información", text: "Mantén el control de dónde viven los archivos de tu organización y quién puede acceder a ellos." },
  { icon: "files", title: "Un solo espacio", text: "Organiza carpetas y documentos de equipo desde una experiencia de trabajo común." },
  { icon: "activity", title: "Crece a tu ritmo", text: "Empieza con una configuración sencilla y amplía tu capacidad según las necesidades del equipo." },
];
const storageTypes = [
  { icon: "cloud", title: "Cloud", tag: "NUBE", text: "Accede a tus archivos desde distintos dispositivos con almacenamiento administrado en la nube." },
  { icon: "server", title: "Servidor local", tag: "ON-PREMISES", text: "Conserva los datos en infraestructura de tu organización para mantener control operativo directo." },
  { icon: "layers", title: "Modelo híbrido", tag: "FLEXIBLE", text: "Combina almacenamiento cloud y local de acuerdo con las políticas de cada organización." },
];

export default function HomePage() {
  const featuredPlan = getPlan("business");
  return <main className="public-site">
    <PublicHeader />
    <section className="public-hero">
      <div className="public-hero-inner">
        <div className="public-hero-copy"><span className="public-kicker">NEXUS · NEXO DIGITAL</span><h1>Almacenamiento en la nube, local e híbrido</h1><p>Una forma segura y flexible de organizar, proteger y compartir los archivos de tu organización.</p><div className="public-hero-actions"><Link className="button public-button-outline" href="/login">Ingresar</Link><Link className="button public-button-coral" href="/registro">Crear cuenta <UiIcon name="arrowRight" size={15} /></Link></div><div className="hero-caption"><span className="hero-caption-mark"><UiIcon name="check" size={13} /></span> Diseñado para equipos que necesitan control y flexibilidad</div></div>
        <StorageIllustration />
      </div>
      <div className="hero-bottom-fade" />
    </section>
    <section className="public-section benefits-section" id="beneficios"><SectionHeading eyebrow="UNA PLATAFORMA PARA TU EQUIPO" title="Tus archivos, bajo tu control" text="Nexus reúne almacenamiento, organización y acceso en una experiencia creada para las necesidades de cada organización."/><div className="benefit-grid">{benefits.map((benefit) => <article className="benefit-card" key={benefit.title}><span className="benefit-icon"><UiIcon name={benefit.icon as "shield" | "files" | "activity"} size={21} /></span><h3>{benefit.title}</h3><p>{benefit.text}</p></article>)}</div></section>
    <section className="public-section storage-section" id="almacenamiento"><SectionHeading eyebrow="ELIGE CÓMO ALMACENAR" title="Tres formas de guardar tus archivos" text="Elige una opción o combina destinos según la operación de tu organización."/><div className="storage-type-grid">{storageTypes.map((item) => <article className="storage-type-card" key={item.title}><span className="storage-type-icon"><UiIcon name={item.icon as "cloud" | "server" | "layers"} size={21} /></span><span className="storage-type-tag">{item.tag}</span><h3>{item.title}</h3><p>{item.text}</p><Link href="/servicios">Conocer el servicio <UiIcon name="arrowRight" size={14} /></Link></article>)}</div><div className="storage-note"><span><UiIcon name="info" size={17} /></span><p>El despliegue híbrido forma parte de la arquitectura objetivo de Nexus. Consulta disponibilidad y requisitos con nuestro equipo.</p><Link href="/contacto">Solicitar información <UiIcon name="arrowRight" size={14} /></Link></div></section>
    <section className="security-section" id="seguridad"><div className="security-inner"><div className="security-emblem"><span><UiIcon name="shield" size={52} /></span><i /><i /><i /></div><div><span className="public-kicker">SEGURIDAD DESDE EL DISEÑO</span><h2>Protección en cada capa</h2><p>La arquitectura de Nexus separa los metadatos del contenido de tus archivos y contempla acceso por organización, permisos y cifrado.</p><div className="security-points"><span><i><UiIcon name="check" size={12} /></i> Identidad y sesiones seguras</span><span><i><UiIcon name="check" size={12} /></i> Aislamiento entre organizaciones</span><span><i><UiIcon name="check" size={12} /></i> Contenido separado de metadatos</span></div><p className="security-footnote">Las funciones de seguridad se habilitan conforme se complete la integración de los servicios.</p></div></div></section>
    <section className="public-section public-plans-preview"><div className="plans-preview-copy"><span className="public-kicker">PLANES FLEXIBLES</span><h2>Empieza con el plan adecuado para tu equipo</h2><p>Compara capacidad, usuarios y precios mensuales en USD antes de impuestos. La contratación es simulada.</p><Link className="button public-button-purple" href="/planes">Explorar planes <UiIcon name="arrowRight" size={15} /></Link></div><article className="preview-plan-card"><span className="preview-plan-label">PLAN {featuredPlan.name.toUpperCase()} · PROPUESTA</span><div className="preview-plan-price">${featuredPlan.priceUsd.toFixed(2)} <small>USD · mensual</small></div><div className="preview-plan-divider"/><div className="preview-plan-feature"><span><UiIcon name="check" size={14} /></span> {featuredPlan.storageGb} GB de almacenamiento</div><div className="preview-plan-feature"><span><UiIcon name="organizations" size={14} /></span> Hasta {featuredPlan.users} usuarios</div><Link href="/planes">Ver detalles del catálogo <UiIcon name="arrowRight" size={14} /></Link></article></section>
    <section className="contact-cta"><div><span className="public-kicker">¿NECESITAS ORIENTACIÓN?</span><h2>Hablemos de tu espacio de almacenamiento</h2><p>Cuéntanos qué necesita tu organización y solicita más información.</p></div><Link className="button public-button-coral" href="/contacto">Contactar al equipo <UiIcon name="arrowRight" size={15} /></Link></section>
    <PublicFooter />
  </main>;
}
