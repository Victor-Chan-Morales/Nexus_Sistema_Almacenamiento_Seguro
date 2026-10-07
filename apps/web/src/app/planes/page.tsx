import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/public-site";
import { UiIcon } from "@/components/ui-icon";
import { PUBLIC_PLANS } from "@/lib/plans";

export default function PlansPage() {
  return (
    <main className="public-site">
      <PublicHeader />
      <section className="plans-hero">
        <span className="public-kicker">PLANES NEXUS</span>
        <h1>El espacio que tu organización necesita</h1>
        <p>Compara capacidad, usuarios y vigencia para encontrar una opción adecuada para tu equipo.</p>
        <a href="#catalogo" className="button public-button-coral">
          Ver planes <UiIcon name="arrowDown" size={15} />
        </a>
        <div className="plans-hero-orbit" aria-hidden="true">
          <span>GB</span>
          <i><UiIcon name="storage" size={18} /></i>
          <i><UiIcon name="plus" size={17} /></i>
          <i><UiIcon name="plans" size={18} /></i>
        </div>
      </section>
      <section className="public-section public-plan-catalog" id="catalogo">
        <div className="plan-catalog-heading">
          <div>
            <span className="public-kicker">CATÁLOGO DE PLANES</span>
            <h2>Opciones para empezar y crecer</h2>
            <p>Precios mensuales en USD, antes de impuestos. Activación simulada.</p>
          </div>
          <span className="catalog-mark">NEXUS <i>PLANES</i></span>
        </div>
        <div className="public-plans-grid">
          {PUBLIC_PLANS.map((plan) => (
            <article className={`public-plan-card ${plan.id === "business" ? "public-plan-featured" : ""}`} key={plan.id}>
              <div className="public-plan-top">
                <span className="public-plan-badge">{plan.id === "demo" ? "PARA COMENZAR" : "PLAN MENSUAL"}</span>
                {plan.id === "business" && <span className="popular-pill">POPULAR</span>}
              </div>
              <h3>{plan.name}</h3>
              <p className="public-plan-description">{plan.description}</p>
              <div className="public-plan-price">
                {plan.priceUsd === 0 ? "Gratis" : `$${plan.priceUsd.toFixed(2)}`}
                <small>{plan.priceUsd === 0 ? "sin vencimiento" : `USD · ${plan.priceSource}`}</small>
              </div>
              <div className="public-plan-specs">
                <div><span>Almacenamiento</span><b>{plan.storageGb >= 1000 ? `${plan.storageGb / 1000} TB` : `${plan.storageGb} GB`}</b></div>
                <div><span>Límite de usuarios</span><b>Hasta {plan.users}</b></div>
                <div><span>Vigencia</span><b>{plan.validity}</b></div>
              </div>
              <Link className={`button ${plan.id === "business" ? "public-button-purple" : "public-plan-secondary"}`} href={`/planes/${plan.id}`}>
                Ver detalles <UiIcon name="arrowRight" size={14} />
              </Link>
            </article>
          ))}
        </div>
        <div className="catalog-disclaimer">
          <span><UiIcon name="info" size={17} /></span>
          <p><b>Propuesta comercial inicial.</b> Precios SaaS antes de impuestos. La instalación local o híbrida, migraciones y soporte especializado se cotizan según alcance. No se procesan pagos reales.</p>
        </div>
      </section>
      <section className="plans-help">
        <div>
          <span className="public-kicker">¿TIENES DUDAS?</span>
          <h2>Te ayudamos a elegir</h2>
          <p>Cuéntanos sobre tu organización y te orientamos sobre almacenamiento cloud, local o híbrido.</p>
        </div>
        <Link className="button public-button-coral" href="/contacto">Hablar con el equipo <UiIcon name="arrowRight" size={15} /></Link>
      </section>
      <PublicFooter />
    </main>
  );
}
