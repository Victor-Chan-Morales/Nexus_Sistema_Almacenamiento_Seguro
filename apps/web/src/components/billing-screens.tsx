"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ApiError } from "@/lib/api/client";
import { activateSubscription, getPlans } from "@/lib/api/billing";
import { getDashboard } from "@/lib/api/dashboard";
import type { ActivateSubscriptionResponse, DashboardResponse, Plan } from "@/lib/api/types";
import { formatBytes, formatIsoDate, usagePercent } from "@/lib/format";
import { RequireSession, useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { Brand } from "@/components/brand";
import { UiIcon } from "@/components/ui-icon";

function BillingFrame({ title, subtitle, children, wide = false }: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) {
  return <main className="billing-page"><Link className="billing-logo-link" href="/" aria-label="Nexus, página principal"><Brand /></Link><section className={`billing-card ${wide ? "billing-card-wide" : ""}`}><header className="billing-heading"><h1>{title}</h1><p>{subtitle}</p></header>{children}</section></main>;
}

function BillingRows({ rows }: { rows: Array<[string, string]> }) {
  return <div className="billing-rows">{rows.map(([label, value]) => <div className="billing-row" key={label}><span>{label}</span><b>{value}</b></div>)}</div>;
}

function Notice({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return <div className="billing-error-box" role="alert"><b>{title}</b><p>{message}</p>{onRetry && <p><button type="button" className="text-button" onClick={onRetry}>Reintentar</button></p>}</div>;
}

function price(plan: Plan) {
  return plan.priceMonthly === 0 ? "Gratis" : `$${plan.priceMonthly.toFixed(2)} USD`;
}

function validity(plan: Plan) {
  return plan.validityDays === null ? "Sin vencimiento" : `${plan.validityDays} días`;
}

function planRows(plan: Plan): Array<[string, string]> {
  return [["Almacenamiento", formatBytes(plan.storageLimitBytes)], ["Límite de usuarios", `Hasta ${plan.userLimit} usuarios`], ["Vigencia", validity(plan)]];
}

const catalogError = "No pudimos cargar el catálogo de planes. Inténtalo de nuevo.";

function useCatalog() {
  const fetcher = useCallback((signal: AbortSignal) => getPlans({ signal }), []);
  return useLoad(fetcher, true, catalogError);
}

function useSelectedPlan(planId: string | null) {
  const catalog = useCatalog();
  if (catalog.state.status !== "ready") return { ...catalog, plan: null as Plan | null };
  return { ...catalog, plan: catalog.state.data.items.find((item) => item.id === planId) ?? null };
}

function PlanState({ status, message, onRetry }: { status: "loading" | "error" | "missing"; message?: string; onRetry?: () => void }) {
  if (status === "loading") return <p className="billing-reference-note" role="status">Cargando plan…</p>;
  if (status === "error") return <Notice title="No se pudo cargar el plan" message={message ?? catalogError} onRetry={onRetry} />;
  return <><Notice title="Plan no disponible" message="El plan solicitado no existe en el catálogo." /><Link className="billing-secondary-link" href="/planes"><UiIcon name="arrowLeft" size={15} /> Volver al catálogo</Link></>;
}

export function PlanDetails({ planId }: { planId: string }) {
  const { state, reload, plan } = useSelectedPlan(planId);
  return <BillingFrame title={plan ? `Plan ${plan.name}` : "Plan"} subtitle="Revisa las condiciones y beneficios del plan.">
    {state.status !== "ready" ? <PlanState status={state.status} message={state.status === "error" ? state.message : undefined} onRetry={reload} /> : !plan ? <PlanState status="missing" /> : <>
      <div className="billing-price">{price(plan)}<small>{validity(plan)} · antes de impuestos</small></div>
      <BillingRows rows={planRows(plan)} />
      <section className="billing-benefits"><h2>Beneficios incluidos</h2><ul><li><span><UiIcon name="check" size={14} /></span>{formatBytes(plan.storageLimitBytes)} de almacenamiento</li><li><span><UiIcon name="check" size={14} /></span>Hasta {plan.userLimit} usuarios</li></ul></section>
      <p className="billing-reference-note">La activación es simulada y no se realizará ningún cobro real.</p>
      <Link className="button button-primary billing-primary" href={`/suscripcion/confirmar?plan=${encodeURIComponent(plan.id)}`}>{plan.priceMonthly === 0 ? "Activar este plan" : "Continuar a la contratación"}</Link>
      <Link className="billing-secondary-link" href="/planes"><UiIcon name="arrowLeft" size={15} /> Volver al catálogo</Link>
    </>}
  </BillingFrame>;
}

function ConfirmationContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, failSession } = useSession();
  const planId = params.get("plan");
  const { state, reload, plan } = useSelectedPlan(planId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (!plan || !session) return;
    setBusy(true); setError("");
    try {
      const result: ActivateSubscriptionResponse = await activateSubscription(plan.id, session.accessToken);
      router.push(`/suscripcion/exito?plan=${encodeURIComponent(plan.id)}&start=${encodeURIComponent(result.startDate)}&end=${encodeURIComponent(result.endDate ?? "")}`);
    } catch (err) {
      if (failSession(err)) return;
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) router.push(`/suscripcion/cambio-rechazado?plan=${encodeURIComponent(plan.id)}`);
      else router.push(`/suscripcion/fallida?plan=${encodeURIComponent(plan.id)}`);
    }
  }

  return <BillingFrame wide title="Resumen de contratación" subtitle="Revisa los detalles antes de confirmar.">
    {state.status !== "ready" ? <PlanState status={state.status} message={state.status === "error" ? state.message : undefined} onRetry={reload} /> : !plan ? <PlanState status="missing" /> : <>
      <BillingRows rows={[["Plan seleccionado", `Plan ${plan.name}`], ["Espacio incluido", formatBytes(plan.storageLimitBytes)], ["Límite de usuarios", `Hasta ${plan.userLimit} usuarios`], ["Vigencia", validity(plan)], ["Importe mensual", price(plan)]]} />
      <p className="billing-terms">Al confirmar, aceptas las condiciones generales del servicio. Este es un entorno de prueba y no se realizará ningún cobro real.</p>
      <div className="billing-warning"><span aria-hidden="true">△</span><div><b>Contratación simulada</b><p>No se solicitan datos de tarjeta ni se procesa ningún cobro real.</p></div></div>
      {error && <Notice title="No se pudo confirmar" message={error} />}
      <button className="button button-primary billing-primary" onClick={confirm} disabled={busy}>{busy ? "Activando…" : "Confirmar activación simulada"}</button>
      <Link className="billing-secondary-link" href={`/planes/${plan.id}`}>Cancelar</Link>
    </>}
  </BillingFrame>;
}

export function ContractConfirmation() {
  return <RequireSession>{() => <Suspense fallback={null}><ConfirmationContent /></Suspense>}</RequireSession>;
}

function SuccessContent() {
  const params = useSearchParams();
  const { state, plan } = useSelectedPlan(params.get("plan"));
  const start = params.get("start");
  const end = params.get("end");
  return <BillingFrame wide title="Activación simulada realizada" subtitle="Tu plan ha sido activado.">
    <div className="billing-outcome-success"><span><UiIcon name="check" size={34} /></span></div>
    {state.status === "ready" && plan ? <BillingRows rows={[["Plan contratado", `Plan ${plan.name}`], ["Importe", price(plan)], ["Inicio", formatIsoDate(start)], ["Vigencia hasta", end ? formatIsoDate(end) : "Sin vencimiento"]]} /> : <p className="billing-reference-note" role="status">La activación se registró en el servidor.</p>}
    <div className="billing-warning"><span aria-hidden="true">△</span><div><b>Aviso de demostración</b><p>Esta activación es simulada y no representa un cobro real.</p></div></div>
    <Link className="button button-primary billing-primary" href="/dashboard">Continuar al escritorio</Link>
    <Link className="billing-secondary-link" href="/suscripcion">Ver suscripción</Link>
  </BillingFrame>;
}

export function ContractSuccess() {
  return <RequireSession>{() => <Suspense fallback={null}><SuccessContent /></Suspense>}</RequireSession>;
}

function FailureContent() {
  const params = useSearchParams();
  const planId = params.get("plan");
  return <BillingFrame title="No se pudo completar la contratación" subtitle="El servidor no pudo activar el plan.">
    <div className="billing-outcome-failure"><span><UiIcon name="warning" size={30} /></span></div>
    <div className="billing-error-box"><b>La suscripción actual no cambió</b><p>No se realizó ningún cobro. Puedes revisar el plan e intentarlo de nuevo.</p></div>
    <Link className="button button-primary billing-primary" href={planId ? `/suscripcion/confirmar?plan=${encodeURIComponent(planId)}` : "/planes"}>Intentar de nuevo</Link>
    <Link className="billing-secondary-link" href="/planes">Volver al catálogo de planes</Link>
  </BillingFrame>;
}

export function ContractFailure() {
  return <Suspense fallback={null}><FailureContent /></Suspense>;
}

function CurrentSubscriptionContent() {
  const { session } = useSession();
  const token = session?.accessToken;
  const fetcher = useCallback((signal: AbortSignal) => getDashboard(token ?? "", { signal }), [token]);
  const { state, reload } = useLoad<DashboardResponse>(fetcher, Boolean(token), "No pudimos cargar tu suscripción. Inténtalo de nuevo.");

  return <BillingFrame wide title="Tu suscripción" subtitle="Consulta los detalles de tu plan actual.">
    {state.status === "loading" && <p className="billing-reference-note" role="status">Cargando suscripción…</p>}
    {state.status === "error" && <Notice title="No se pudo cargar la suscripción" message={state.message} onRetry={reload} />}
    {state.status === "ready" && (state.data.plan ? <ActiveSubscription data={state.data} plan={state.data.plan} /> : <><div className="billing-error-box"><b>No hay un plan activo</b><p>Contrata un plan para definir el límite de almacenamiento de tu organización.</p></div><Link className="button button-primary billing-primary" href="/planes">Contratar un plan</Link></>)}
  </BillingFrame>;
}

function ActiveSubscription({ data, plan }: { data: DashboardResponse; plan: NonNullable<DashboardResponse["plan"]> }) {
  const expired = plan.expiresAt ? new Date(plan.expiresAt).getTime() < Date.now() : false;
  const pct = usagePercent(data.storageUsedBytes, data.storageLimitBytes);
  return <>
    <div className="billing-status"><span className="status-dot" /> {expired ? "Vencida" : "Activo"}</div>
    <BillingRows rows={[["Plan actual", plan.name], ["Estado", expired ? "Vencida" : "Activo"], ["Vencimiento", formatIsoDate(plan.expiresAt)], ["Espacio incluido", formatBytes(plan.storageLimitBytes)], ["Espacio utilizado", formatBytes(data.storageUsedBytes)], ["Límite de usuarios", `Hasta ${plan.userLimit}`]]} />
    <div className="billing-progress"><span style={{ width: `${pct}%` }} /></div><p className="billing-progress-label">{formatBytes(data.storageUsedBytes)} de {formatBytes(data.storageLimitBytes)} utilizados</p>
    <div className="billing-actions"><Link className="button button-primary billing-primary" href="/planes">Contratar o cambiar de plan</Link></div>
    <p className="billing-reference-note">Suscripción simulada: no hay cobros ni datos de tarjeta.</p>
  </>;
}

export function CurrentSubscription() {
  return <RequireSession>{() => <CurrentSubscriptionContent />}</RequireSession>;
}

function ChangeRejectedContent() {
  const params = useSearchParams();
  const planId = params.get("plan");
  return <BillingFrame title="No se pudo cambiar el plan" subtitle="La solicitud fue rechazada por el servidor.">
    <div className="billing-outcome-failure"><span><UiIcon name="warning" size={30} /></span></div>
    <div className="billing-error-box"><b>Cambio no permitido</b><p>El plan elegido no puede aplicarse a tu organización. Si el espacio ocupado supera el límite del plan nuevo, libera espacio antes de solicitarlo otra vez.</p></div>
    <Link className="button button-primary billing-primary" href={planId ? `/planes/${encodeURIComponent(planId)}` : "/planes"}>Elegir otro plan</Link>
    <Link className="billing-secondary-link" href="/suscripcion">Volver a la suscripción</Link>
  </BillingFrame>;
}

export function ChangePlanRejected() {
  return <Suspense fallback={null}><ChangeRejectedContent /></Suspense>;
}

function ChangePlanContent() {
  const router = useRouter();
  const { session, failSession } = useSession();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const { state, reload } = useCatalog();
  const plans = state.status === "ready" ? state.data.items : [];
  const chosen = plans.find((item) => item.id === selected) ?? null;

  async function submit() {
    if (!chosen || !session) return;
    setBusy(true);
    try {
      const result = await activateSubscription(chosen.id, session.accessToken);
      router.push(`/suscripcion/exito?plan=${encodeURIComponent(chosen.id)}&start=${encodeURIComponent(result.startDate)}&end=${encodeURIComponent(result.endDate ?? "")}`);
    } catch (err) {
      if (failSession(err)) return;
      router.push(`/suscripcion/cambio-rechazado?plan=${encodeURIComponent(chosen.id)}`);
    }
  }

  return <BillingFrame title="Solicitar cambio de plan" subtitle="Elige el plan al que deseas cambiar.">
    {state.status === "loading" && <p className="billing-reference-note" role="status">Cargando planes…</p>}
    {state.status === "error" && <Notice title="No se pudo cargar el catálogo" message={state.message} onRetry={reload} />}
    {state.status === "ready" && (plans.length === 0 ? <Notice title="Catálogo vacío" message="Todavía no hay planes disponibles para contratar." /> : <>
      <label className="billing-select-label" htmlFor="target-plan">Nuevo plan</label>
      <select className="billing-select" id="target-plan" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Selecciona un plan</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatBytes(item.storageLimitBytes)} · hasta {item.userLimit} usuarios</option>)}</select>
      {chosen && <BillingRows rows={[["Almacenamiento del plan nuevo", formatBytes(chosen.storageLimitBytes)], ["Precio", price(chosen)]]} />}
      <p className="billing-reference-note">El servidor valida el cambio frente al uso actual. Si el espacio ocupado supera el límite, la solicitud será rechazada.</p>
      <button className="button button-primary billing-primary" onClick={submit} disabled={!chosen || busy}>{busy ? "Enviando…" : "Enviar solicitud de cambio"}</button>
    </>)}
    <Link className="billing-secondary-link" href="/suscripcion">Cancelar</Link>
  </BillingFrame>;
}

export function ChangePlanRequest() {
  return <RequireSession>{() => <ChangePlanContent />}</RequireSession>;
}

export function SubscriptionExpired() {
  return <BillingFrame title="Suscripción vencida" subtitle="Tu organización no tiene una suscripción activa.">
    <div className="billing-outcome-failure"><span>!</span></div>
    <div className="billing-error-box"><b>No hay un plan activo</b><p>Puedes consultar y descargar los archivos existentes. Las cargas nuevas se bloquean hasta contratar un plan.</p></div>
    <div className="billing-expired-actions"><Link className="button billing-secondary" href="/archivos">Consultar mis archivos</Link><Link className="button button-primary billing-primary" href="/planes">Contratar un plan</Link></div>
  </BillingFrame>;
}
