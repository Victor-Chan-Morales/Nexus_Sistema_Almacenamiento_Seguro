"use client";

import { useCallback } from "react";
import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/public-site";
import { UiIcon } from "@/components/ui-icon";
import { Notice } from "@/components/notice";
import { LoadingIndicator } from "@/components/toast";
import { getPlans } from "@/lib/api/billing";
import { getDashboard } from "@/lib/api/dashboard";
import { formatBytes } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

export default function PlansPage() {
  const { session, restoring } = useSession();
  const token = session?.accessToken;
  const fetchCatalog = useCallback((signal: AbortSignal) => getPlans({ signal }), []);
  const fetchDashboard = useCallback(async (signal: AbortSignal) => {
    if (!token) return null;
    const dashboard = await getDashboard(token, { signal });
    return { token, planId: dashboard.plan?.id };
  }, [token]);
  const { state, reload } = useLoad(fetchCatalog);
  const { state: dashboard } = useLoad(fetchDashboard, Boolean(token));
  const currentPlanId = dashboard.status === "ready" && dashboard.data?.token === token
    ? dashboard.data?.planId
    : undefined;
  const data = state.status === "ready" ? state.data : null;
  const loading = state.status === "loading";
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
        {loading && <LoadingIndicator>Cargando planes…</LoadingIndicator>}
        {!loading && state.status === "error" && <Notice title="No se pudo cargar el catálogo" message={state.message} onRetry={reload} />}
        {data && <div className="public-plans-grid">
          {data.items.map((plan) => {
            const current = currentPlanId === plan.id;
            const action = currentPlanId ? "Cambiar a este plan" : "Contratar";
            return <article className={`public-plan-card ${current ? "public-plan-featured" : ""}`} key={plan.id}>
              {current && <span className="public-plan-badge">PLAN ACTUAL</span>}
              <h3>{plan.name}</h3>
              <p className="public-plan-description">{plan.description}</p>
              <div className="public-plan-price">
                {plan.priceMonthly === 0 ? "Gratis" : <>${plan.priceMonthly.toFixed(2)}</>}
                {plan.priceMonthly > 0 && <small>USD al mes</small>}
              </div>
              <div className="public-plan-specs">
                <div><span>Almacenamiento</span><b>{formatBytes(plan.storageLimitBytes)}</b></div>
                <div><span>Límite de usuarios</span><b>Hasta {plan.userLimit}</b></div>
                <div><span>Vigencia</span><b>{plan.validityDays === null ? "Sin vencimiento" : `${plan.validityDays} días`}</b></div>
              </div>
              {!current && !restoring && <Link className="button public-plan-secondary" href={token ? `/suscripcion/confirmar?plan=${encodeURIComponent(plan.id)}` : "/registro"}>
                {action} <UiIcon name="arrowRight" size={14} />
              </Link>}
            </article>;
          })}
        </div>}
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
