"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { activateSubscription, DemoSubscription, formatBillingDate, initialSubscription, readSubscription, writeSubscription } from "@/lib/billing-demo";
import { getPlan } from "@/lib/plans";
import { NexusMark } from "@/components/brand";

function BillingFrame({ title, subtitle, children, wide = false }: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) {
  return <main className="billing-page"><Link className="billing-logo-link" href="/" aria-label="Nexus, página principal"><NexusMark priority /></Link><section className={`billing-card ${wide ? "billing-card-wide" : ""}`}><header className="billing-heading"><h1>{title}</h1><p>{subtitle}</p></header>{children}</section></main>;
}

function BillingRows({ rows }: { rows: Array<[string, string]> }) {
  return <div className="billing-rows">{rows.map(([label, value]) => <div className="billing-row" key={label}><span>{label}</span><b>{value}</b></div>)}</div>;
}

export function PlanDetails({ planId }: { planId: string }) {
  const plan = getPlan(planId);
  return <BillingFrame title={`Plan ${plan.name}`} subtitle="Revisa las condiciones y beneficios del plan.">
    <div className="billing-price">{plan.priceUsd === 0 ? "Gratis" : `$${plan.priceUsd.toFixed(2)} USD`}<small>{plan.validity}{plan.durationMonths ? " · importe total de referencia" : ""}</small></div>
    <BillingRows rows={[["Almacenamiento", `${plan.storageGb} GB`], ["Límite de usuarios", plan.users === null ? "Por definir" : `${plan.users} usuarios`], ["Vigencia", plan.validity]]} />
    <section className="billing-benefits"><h2>Beneficios incluidos</h2><ul>{plan.benefits.map((benefit) => <li key={benefit}><span>✓</span>{benefit}</li>)}</ul></section>
    {plan.id === "profesional" && <p className="billing-reference-note">Precio y capacidad tomados como referencia de los mockups. El límite de usuarios debe confirmarse con Billing.</p>}
    <Link className="button button-primary billing-primary" href={`/suscripcion/confirmar?plan=${plan.id}`}>{plan.priceUsd === 0 ? "Activar plan Demo" : "Continuar a la contratación"}</Link>
    <Link className="billing-secondary-link" href="/planes">← Volver al catálogo</Link>
  </BillingFrame>;
}

export function ContractConfirmation() {
  const router = useRouter();
  const [planId, setPlanId] = useState("profesional");
  useEffect(() => { setPlanId(new URLSearchParams(window.location.search).get("plan") ?? "profesional"); }, []);
  const plan = getPlan(planId);
  return <BillingFrame wide title="Resumen de contratación" subtitle="Revisa los detalles antes de confirmar.">
    <BillingRows rows={[["Plan seleccionado", `Plan ${plan.name}`], ["Espacio incluido", `${plan.storageGb} GB`], ["Límite de usuarios", plan.users === null ? "Por definir" : `${plan.users} usuarios`], ["Vigencia", plan.validity], ["Importe total", plan.priceUsd === 0 ? "Gratis" : `$${plan.priceUsd.toFixed(2)} USD`]]} />
    <p className="billing-terms">Al confirmar, aceptas las condiciones generales del servicio. Este es un entorno de prueba y no se realizará ningún cobro real.</p>
    <div className="billing-warning"><span aria-hidden="true">△</span><div><b>Pago simulado</b><p>Esta contratación es de demostración. No se procesará ningún cobro real.</p></div></div>
    <button className="button button-primary billing-primary" onClick={() => router.push(`/suscripcion/exito?plan=${plan.id}`)}>Confirmar pago simulado</button>
    <button className="button billing-secondary" onClick={() => router.push(`/suscripcion/fallida?plan=${plan.id}`)}>Simular pago fallido</button>
    <Link className="billing-secondary-link" href={`/planes/${plan.id}`}>Cancelar</Link>
  </BillingFrame>;
}

export function ContractSuccess() {
  const [planId, setPlanId] = useState("profesional");
  const [startedAt, setStartedAt] = useState("");
  const [expiry, setExpiry] = useState("");
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("plan") ?? "profesional";
    const subscription = activateSubscription(selected);
    setPlanId(selected); setStartedAt(formatBillingDate(subscription.startedAt)); setExpiry(formatBillingDate(subscription.expiresAt));
  }, []);
  const plan = getPlan(planId);
  return <BillingFrame wide title="Pago simulado realizado correctamente" subtitle="Tu plan ha sido activado.">
    <div className="billing-outcome-success"><span>✓</span></div>
    <BillingRows rows={[["Plan contratado", `Plan ${plan.name}`], ["Importe", plan.priceUsd === 0 ? "Gratis" : `$${plan.priceUsd.toFixed(2)} USD`], ["Fecha", startedAt || "—"], ["Vigencia hasta", expiry || "—"], ["Referencia", "SIM-2026-00125"]]} />
    <div className="billing-warning"><span aria-hidden="true">△</span><div><b>Aviso de demostración</b><p>Este pago es simulado y no representa un cobro real.</p></div></div>
    <Link className="button button-primary billing-primary" href="/dashboard">Continuar al escritorio</Link>
    <Link className="billing-secondary-link" href="/suscripcion">Ver suscripción</Link>
  </BillingFrame>;
}

export function ContractFailure() {
  const [planId, setPlanId] = useState("profesional");
  useEffect(() => { setPlanId(new URLSearchParams(window.location.search).get("plan") ?? "profesional"); }, []);
  const plan = getPlan(planId);
  return <BillingFrame title="No se pudo completar la contratación" subtitle="El pago de demostración no fue aprobado.">
    <div className="billing-outcome-failure"><span>!</span></div>
    <div className="billing-error-box"><b>No se realizó ningún cobro</b><p>La suscripción actual no cambió. Puedes revisar el plan e intentarlo de nuevo.</p></div>
    <Link className="button button-primary billing-primary" href={`/suscripcion/confirmar?plan=${plan.id}`}>Intentar de nuevo</Link>
    <Link className="billing-secondary-link" href="/planes">Volver al catálogo de planes</Link>
  </BillingFrame>;
}

export function CurrentSubscription() {
  const [subscription, setSubscription] = useState<DemoSubscription | null>(null);
  useEffect(() => { setSubscription(readSubscription()); }, []);
  const data = subscription ?? initialSubscription;
  const plan = getPlan(data.planId);
  const pct = Math.min(100, data.storageUsedGb / plan.storageGb * 100);
  if (data.status === "expired") return <SubscriptionExpired />;
  return <BillingFrame wide title="Tu suscripción" subtitle="Consulta los detalles de tu plan actual.">
    <div className="billing-status"><span className="status-dot" /> Activo</div>
    <BillingRows rows={[["Plan actual", plan.name], ["Estado", "Activo"], ["Inicio", formatBillingDate(data.startedAt)], ["Vencimiento", formatBillingDate(data.expiresAt)], ["Espacio incluido", `${plan.storageGb} GB`], ["Espacio utilizado", `${data.storageUsedGb} GB`], ["Usuarios utilizados", `${data.usersUsed}${plan.users ? ` de ${plan.users}` : " · límite por definir"}`]]} />
    <div className="billing-progress"><span style={{ width: `${pct}%` }} /></div><p className="billing-progress-label">{data.storageUsedGb} GB de {plan.storageGb} GB utilizados</p>
    <div className="billing-actions"><Link className="button button-primary billing-primary" href="/planes">Renovar o contratar un plan</Link><Link className="button billing-secondary" href="/suscripcion/cambiar-plan">Solicitar cambio de plan</Link><Link className="billing-secondary-link" href="/suscripcion/vencida" onClick={() => writeSubscription({ ...data, status: "expired" })}>Simular vencimiento de la suscripción</Link></div>
    <p className="billing-reference-note">Datos de capacidad y fechas de demostración basados en el mockup de suscripción. El límite Profesional de usuarios está pendiente de confirmación.</p>
  </BillingFrame>;
}

export function ChangePlanRequest() {
  const router = useRouter();
  const [subscription, setSubscription] = useState<DemoSubscription>(initialSubscription);
  useEffect(() => { setSubscription(readSubscription()); }, []);
  const currentPlan = getPlan(subscription.planId);
  const targetPlan = getPlan("demo");
  const exceedsTarget = subscription.storageUsedGb > targetPlan.storageGb || subscription.usersUsed > (targetPlan.users ?? Number.POSITIVE_INFINITY);
  return <BillingFrame title="Solicitar cambio de plan" subtitle="Elige el plan al que deseas cambiar.">
    <BillingRows rows={[["Plan actual", currentPlan.name], ["Uso actual", `${subscription.storageUsedGb} GB`]]} />
    <label className="billing-select-label" htmlFor="target-plan">Nuevo plan</label>
    <select className="billing-select" id="target-plan" value="demo" onChange={() => undefined}><option value="demo">Demo · 5 GB · hasta 5 usuarios</option></select>
    <BillingRows rows={[["Almacenamiento del plan nuevo", `${targetPlan.storageGb} GB`], ["Precio", "Gratis · demostración"]]} />
    <p className="billing-reference-note">El cambio se validará frente al uso actual. Si el espacio ocupado supera el límite, la solicitud no podrá completarse.</p>
    <button className="button button-primary billing-primary" onClick={() => {
      if (exceedsTarget) { router.push("/suscripcion/cambio-rechazado"); return; }
      writeSubscription({ ...subscription, planId: targetPlan.id });
      router.push("/suscripcion");
    }}>Enviar solicitud de cambio</button>
    <Link className="billing-secondary-link" href="/suscripcion">Cancelar</Link>
  </BillingFrame>;
}

export function ChangePlanRejected() {
  const [used, setUsed] = useState(initialSubscription.storageUsedGb);
  useEffect(() => { setUsed(readSubscription().storageUsedGb); }, []);
  return <BillingFrame title="No se pudo cambiar el plan" subtitle="La solicitud fue rechazada por los límites de almacenamiento.">
    <div className="billing-outcome-failure"><span>!</span></div>
    <div className="billing-error-box"><b>Uso superior al límite</b><p>Tu organización utiliza {used} GB y el plan Demo permite 5 GB. Elimina o descarga archivos hasta cumplir el límite antes de solicitar el cambio.</p><p><strong>Motivo del rechazo:</strong> almacenamiento utilizado superior a la capacidad del plan seleccionado.</p></div>
    <Link className="button button-primary billing-primary" href="/suscripcion/cambiar-plan">Elegir otro plan</Link>
    <Link className="billing-secondary-link" href="/suscripcion">Volver a la suscripción</Link>
  </BillingFrame>;
}

export function SubscriptionExpired() {
  return <BillingFrame title="Suscripción vencida" subtitle="Tu organización no tiene una suscripción activa.">
    <div className="billing-outcome-failure"><span>!</span></div>
    <div className="billing-error-box"><b>Tu plan venció</b><p>Puedes consultar y descargar los archivos existentes. Las cargas nuevas están bloqueadas hasta contratar un plan.</p></div>
    <div className="billing-expired-actions"><Link className="button billing-secondary" href="/archivos">Consultar mis archivos</Link><Link className="button button-primary billing-primary" href="/planes">Contratar un plan</Link></div>
  </BillingFrame>;
}
