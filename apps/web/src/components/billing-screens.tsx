"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ApiError } from "@/lib/api/client";
import { activateSubscription, getBillingOperations, getBillingReceipt, getPlans, renewSubscription } from "@/lib/api/billing";
import { getDashboard } from "@/lib/api/dashboard";
import type { ActivateSubscriptionResponse, BillingOperationsResponse, BillingReceipt, DashboardResponse, PaymentCardPayload, Plan } from "@/lib/api/types";
import { formatBytes, formatIsoDate, formatUsd, usagePercent } from "@/lib/format";
import { RequireSession, useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { Brand } from "@/components/brand";
import { LoadingIndicator } from "@/components/toast";
import { Notice } from "@/components/notice";
import { PaymentForm } from "@/components/payment-form";
import { UiIcon } from "@/components/ui-icon";

function BillingFrame({ title, subtitle, children, wide = false }: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) {
  return <main className="billing-page"><Link className="billing-logo-link no-print" href="/" aria-label="Nexus, página principal"><Brand /></Link><section className={`billing-card ${wide ? "billing-card-wide" : ""}`}><header className="billing-heading"><h1>{title}</h1><p>{subtitle}</p></header>{children}</section></main>;
}

function BillingRows({ rows }: { rows: Array<[string, string]> }) {
  return <div className="billing-rows">{rows.map(([label, value]) => <div className="billing-row" key={label}><span>{label}</span><b>{value}</b></div>)}</div>;
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

type ActivationOutcome = { formError: string } | { redirect: string };

// Ramifica por code (no por status HTTP): los 409/422 ya no van todos a cambio-rechazado.
function activationOutcome(err: unknown, planId: string): ActivationOutcome {
  const id = encodeURIComponent(planId);
  if (err instanceof ApiError) {
    if (err.code === "VALIDATION_ERROR" || err.code === "TEST_CARD_REQUIRED") return { formError: err.message };
    if (err.code === "PAYMENT_DECLINED") return { redirect: `/suscripcion/fallida?plan=${id}&motivo=tarjeta` };
    if (err.code === "STORAGE_QUOTA_EXCEEDED") return { redirect: `/suscripcion/cambio-rechazado?plan=${id}` };
  }
  if (err instanceof ApiError && err.status === 409) return { redirect: `/suscripcion/cambio-rechazado?plan=${id}` };
  return { redirect: `/suscripcion/fallida?plan=${id}` };
}

const alreadyActiveNote = "Este plan ya está activo: no se solicita tarjeta.";

// Solo decide qué mostrar; el backend sigue siendo la autoridad sobre el pago.
function useCurrentPlanId() {
  const { session } = useSession();
  const token = session?.accessToken;
  const fetcher = useCallback((signal: AbortSignal) => getDashboard(token ?? "", { signal }), [token]);
  const { state } = useLoad<DashboardResponse>(fetcher, Boolean(session), "No pudimos comprobar tu suscripción.");
  const currentPlanId: string | null = state.status === "ready" ? state.data.plan?.id ?? null : null;
  return { status: state.status, currentPlanId };
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
  if (status === "loading") return <LoadingIndicator>Cargando plan…</LoadingIndicator>;
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
  const current = useCurrentPlanId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm(payment?: PaymentCardPayload) {
    if (!plan || !session) return;
    setBusy(true); setError("");
    try {
      const result: ActivateSubscriptionResponse = await activateSubscription(plan.id, session.accessToken, payment);
      router.push(`/suscripcion/exito?plan=${encodeURIComponent(plan.id)}&start=${encodeURIComponent(result.startDate)}&end=${encodeURIComponent(result.endDate ?? "")}`);
    } catch (err) {
      if (failSession(err)) return;
      const outcome = activationOutcome(err, plan.id);
      if ("formError" in outcome) { setError(outcome.formError); setBusy(false); }
      else router.push(outcome.redirect);
    }
  }

  return <BillingFrame wide title="Resumen de contratación" subtitle="Revisa los detalles antes de confirmar.">
    {state.status !== "ready" ? <PlanState status={state.status} message={state.status === "error" ? state.message : undefined} onRetry={reload} /> : !plan ? <PlanState status="missing" /> : <>
      <BillingRows rows={[["Plan seleccionado", `Plan ${plan.name}`], ["Espacio incluido", formatBytes(plan.storageLimitBytes)], ["Límite de usuarios", `Hasta ${plan.userLimit} usuarios`], ["Vigencia", validity(plan)], ["Importe mensual", price(plan)]]} />
      <p className="billing-terms">Al confirmar, aceptas las condiciones generales del servicio. Este es un entorno de prueba y no se realizará ningún cobro real.</p>
      <div className="billing-warning"><span aria-hidden="true">△</span><div><b>Contratación simulada</b><p>Los pagos usan tarjetas de prueba y no se procesa ningún cobro real.</p></div></div>
      {current.status === "loading"
        ? <p className="billing-reference-note" role="status">Comprobando tu suscripción…</p>
        : plan.priceMonthly > 0 && plan.id !== current.currentPlanId
          ? <PaymentForm onSubmit={confirm} submitLabel="Confirmar activación simulada" disabled={busy} error={error} />
          : <>{plan.priceMonthly > 0 && <p className="billing-reference-note">{alreadyActiveNote}</p>}{error && <Notice title="No se pudo confirmar" message={error} />}<button className="button button-primary billing-primary" onClick={() => confirm()} disabled={busy}>{busy ? "Activando…" : "Confirmar activación simulada"}</button></>}
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
  const cardDeclined = params.get("motivo") === "tarjeta";
  return <BillingFrame title="No se pudo completar la contratación" subtitle="El servidor no pudo activar el plan.">
    <div className="billing-outcome-failure"><span><UiIcon name="warning" size={30} /></span></div>
    {cardDeclined
      ? <div className="billing-error-box"><b>Tarjeta de prueba rechazada</b><p>La tarjeta de prueba fue rechazada. No se realizó ningún cobro y tu suscripción no cambió. Inténtalo de nuevo con la tarjeta de prueba aprobada.</p></div>
      : <div className="billing-error-box"><b>La suscripción actual no cambió</b><p>No se realizó ningún cobro. Puedes revisar el plan e intentarlo de nuevo.</p></div>}
    <Link className="button button-primary billing-primary" href={planId ? `/suscripcion/confirmar?plan=${encodeURIComponent(planId)}` : "/planes"}>Intentar de nuevo</Link>
    <Link className="billing-secondary-link" href="/planes">Volver al catálogo de planes</Link>
  </BillingFrame>;
}

export function ContractFailure() {
  return <Suspense fallback={null}><FailureContent /></Suspense>;
}

export function BillingHistoryTable({ token }: { token?: string }) {
  const fetcher = useCallback((signal: AbortSignal) => getBillingOperations(token ?? "", { signal }), [token]);
  const { state, reload } = useLoad<BillingOperationsResponse>(fetcher, Boolean(token), "No pudimos cargar el historial de facturación. Inténtalo de nuevo.");

  return <section className="billing-history" aria-labelledby="billing-history-title">
    <h2 id="billing-history-title">Historial de operaciones</h2>
    {state.status === "loading" && <LoadingIndicator>Cargando historial…</LoadingIndicator>}
    {state.status === "error" && <Notice title="No se pudo cargar el historial" message={state.message} onRetry={reload} />}
    {state.status === "ready" && (state.data.items.length === 0 ? <p className="billing-reference-note">Aún no hay movimientos</p> : <div className="billing-table-wrapper"><table className="billing-table"><thead><tr><th>Fecha</th><th>Plan</th><th>Tipo</th><th>Importe</th><th>Estado</th><th>Comprobante</th></tr></thead><tbody>{state.data.items.map((op) => <tr key={op.id}><td>{formatIsoDate(op.occurredAt)}</td><td>{op.planName}</td><td>{op.type === "renewal" ? "Renovación" : "Cobro"}</td><td>{formatUsd(op.amount)}</td><td><span className="billing-badge">Simulado</span></td><td><Link className="billing-secondary-link" href={`/suscripcion/comprobante/${encodeURIComponent(op.id)}`}>Comprobante</Link></td></tr>)}</tbody></table></div>)}
  </section>;
}

function CurrentSubscriptionContent() {
  const { session } = useSession();
  const token = session?.accessToken;
  const isAdmin = session?.role === "tenant_admin";
  const fetcher = useCallback((signal: AbortSignal) => getDashboard(token ?? "", { signal }), [token]);
  const { state, reload } = useLoad<DashboardResponse>(fetcher, Boolean(token), "No pudimos cargar tu suscripción. Inténtalo de nuevo.");
  const [historyKey, setHistoryKey] = useState(0);

  function handleRenewed() {
    reload();
    setHistoryKey((key) => key + 1);
  }

  return <BillingFrame wide title="Tu suscripción" subtitle="Consulta los detalles de tu plan actual.">
    {state.status === "loading" && <LoadingIndicator>Cargando suscripción…</LoadingIndicator>}
    {state.status === "error" && <Notice title="No se pudo cargar la suscripción" message={state.message} onRetry={reload} />}
    {state.status === "ready" && (state.data.plan ? <ActiveSubscription data={state.data} plan={state.data.plan} isAdmin={isAdmin} token={token} onRenewed={handleRenewed} historyKey={historyKey} /> : <>
      <div className="billing-error-box"><b>No hay un plan activo</b><p>Contrata un plan para definir el límite de almacenamiento de tu organización.</p></div>
      {isAdmin ? <Link className="button button-primary billing-primary" href="/planes">Contratar un plan</Link> : <p className="billing-reference-note">Solo los administradores gestionan la suscripción</p>}
    </>)}
  </BillingFrame>;
}

function ActiveSubscription({ data, plan, isAdmin, token, onRenewed, historyKey }: { data: DashboardResponse; plan: NonNullable<DashboardResponse["plan"]>; isAdmin: boolean; token?: string; onRenewed: () => void; historyKey: number }) {
  const { failSession } = useSession();
  const pct = usagePercent(data.storageUsedBytes, data.storageLimitBytes);
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState("");
  const [showRenewForm, setShowRenewForm] = useState(false);

  async function renew(payment: PaymentCardPayload) {
    if (!token) return;
    setRenewing(true); setRenewError("");
    try {
      await renewSubscription(token, payment);
      setShowRenewForm(false);
      onRenewed();
    } catch (err) {
      if (failSession(err)) return;
      if (err instanceof ApiError && (err.code === "VALIDATION_ERROR" || err.code === "TEST_CARD_REQUIRED" || err.code === "PAYMENT_DECLINED")) setRenewError(err.message);
      else if (err instanceof ApiError && err.code === "PLAN_NOT_RENEWABLE") setRenewError("Este plan no admite renovación.");
      else if (err instanceof ApiError && err.code === "NO_ACTIVE_SUBSCRIPTION") setRenewError("No hay una suscripción activa para renovar.");
      else setRenewError("No se pudo renovar la suscripción. Inténtalo de nuevo.");
    } finally { setRenewing(false); }
  }

  return <>
    <div className="billing-status"><span className="status-dot" /> Activo</div>
    {/* La API solo devuelve suscripciones vigentes: el cliente no calcula vencimientos. */}
    <BillingRows rows={[["Plan actual", plan.name], ["Estado", "Activo"], ["Vencimiento", formatIsoDate(plan.expiresAt)], ["Espacio incluido", formatBytes(plan.storageLimitBytes)], ["Espacio utilizado", formatBytes(data.storageUsedBytes)], ["Límite de usuarios", `Hasta ${plan.userLimit}`]]} />
    <div className="billing-progress"><span style={{ width: `${pct}%` }} /></div><p className="billing-progress-label">{formatBytes(data.storageUsedBytes)} de {formatBytes(data.storageLimitBytes)} utilizados</p>
    {isAdmin ? <>
      <div className="billing-actions">
        <Link className="button button-primary billing-primary" href="/planes">Contratar o cambiar de plan</Link>
        {plan.expiresAt && <button type="button" className="button button-secondary" onClick={() => { setShowRenewForm(true); setRenewError(""); }} disabled={renewing || showRenewForm}>Renovar</button>}
      </div>
      {showRenewForm && <PaymentForm onSubmit={renew} submitLabel="Confirmar renovación simulada" disabled={renewing} error={renewError} />}
      {showRenewForm && <button type="button" className="billing-secondary-link" onClick={() => { setShowRenewForm(false); setRenewError(""); }} disabled={renewing}>Cancelar</button>}
      {!showRenewForm && renewError && <Notice title="No se pudo renovar la suscripción" message={renewError} />}
      <p className="billing-reference-note">Suscripción simulada: los pagos usan tarjetas de prueba.</p>
      <BillingHistoryTable key={historyKey} token={token} />
    </> : <>
      <p className="billing-reference-note">Solo los administradores gestionan la suscripción</p>
      <p className="billing-reference-note">Suscripción simulada: los pagos usan tarjetas de prueba.</p>
    </>}
  </>;
}

export function CurrentSubscription() {
  return <RequireSession>{() => <CurrentSubscriptionContent />}</RequireSession>;
}

// SPEC-306: 403 y 404 son estados de la pantalla; cualquier otro error pasa a useLoad (401 incluido).
type ReceiptResult =
  | { kind: "ready"; receipt: BillingReceipt }
  | { kind: "forbidden" }
  | { kind: "notFound" };

function receiptRows(receipt: BillingReceipt): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Número de comprobante", receipt.receiptNumber],
    ["Organización", receipt.organizationName],
    ["Plan", receipt.planName],
    ["Tipo", receipt.type === "renewal" ? "Renovación" : "Cobro"],
    ["Importe", formatUsd(receipt.amount)],
    ["Fecha", formatIsoDate(receipt.occurredAt)],
  ];
  // Solo los últimos cuatro dígitos; si la operación no tiene tarjeta (Demo, US$0), no hay fila.
  if (receipt.cardLast4 !== null) rows.push(["Tarjeta de prueba", `•••• ${receipt.cardLast4}`]);
  return rows;
}

function ReceiptContent({ operationId }: { operationId: string }) {
  const { session } = useSession();
  const token = session?.accessToken;
  const fetcher = useCallback(async (signal: AbortSignal): Promise<ReceiptResult> => {
    try {
      const receipt = await getBillingReceipt(operationId, token ?? "", { signal });
      return { kind: "ready", receipt };
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 403) return { kind: "forbidden" };
      if (error instanceof ApiError && error.status === 404) return { kind: "notFound" };
      throw error;
    }
  }, [operationId, token]);
  const { state, reload } = useLoad<ReceiptResult>(fetcher, Boolean(token), "No pudimos cargar el comprobante. Inténtalo de nuevo.");

  return <BillingFrame title="Comprobante de operación" subtitle="Registro de una operación simulada de tu organización.">
    {state.status === "loading" && <LoadingIndicator>Cargando comprobante…</LoadingIndicator>}
    {state.status === "error" && <Notice title="No se pudo cargar el comprobante" message={state.message} onRetry={reload} />}
    {state.status === "ready" && state.data.kind === "forbidden" && <div className="billing-error-box"><b>Sin permiso</b><p>No tienes permiso para ver los comprobantes de la organización.</p></div>}
    {state.status === "ready" && state.data.kind === "notFound" && <div className="billing-error-box"><b>Comprobante no encontrado</b><p>El comprobante no existe o no pertenece a tu organización.</p></div>}
    {state.status === "ready" && state.data.kind === "ready" && <>
      <div className="billing-warning"><span aria-hidden="true">△</span><div><b>Simulación: sin valor fiscal</b></div></div>
      <BillingRows rows={receiptRows(state.data.receipt)} />
      <button type="button" className="button button-primary billing-primary no-print" onClick={() => window.print()}>Imprimir o guardar PDF</button>
    </>}
    <Link className="billing-secondary-link no-print" href="/suscripcion"><UiIcon name="arrowLeft" size={15} /> Volver a la suscripción</Link>
  </BillingFrame>;
}

export function ReceiptScreen({ operationId }: { operationId: string }) {
  return <RequireSession>{() => <ReceiptContent operationId={operationId} />}</RequireSession>;
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
  const [error, setError] = useState("");
  const { state, reload } = useCatalog();
  const current = useCurrentPlanId();
  const plans = state.status === "ready" ? state.data.items : [];
  const chosen = plans.find((item) => item.id === selected) ?? null;

  async function submit(payment?: PaymentCardPayload) {
    if (!chosen || !session) return;
    setBusy(true); setError("");
    try {
      const result = await activateSubscription(chosen.id, session.accessToken, payment);
      router.push(`/suscripcion/exito?plan=${encodeURIComponent(chosen.id)}&start=${encodeURIComponent(result.startDate)}&end=${encodeURIComponent(result.endDate ?? "")}`);
    } catch (err) {
      if (failSession(err)) return;
      const outcome = activationOutcome(err, chosen.id);
      if ("formError" in outcome) { setError(outcome.formError); setBusy(false); }
      else router.push(outcome.redirect);
    }
  }

  return <BillingFrame title="Solicitar cambio de plan" subtitle="Elige el plan al que deseas cambiar.">
    {state.status === "loading" && <LoadingIndicator>Cargando planes…</LoadingIndicator>}
    {state.status === "error" && <Notice title="No se pudo cargar el catálogo" message={state.message} onRetry={reload} />}
    {state.status === "ready" && (plans.length === 0 ? <Notice title="Catálogo vacío" message="Todavía no hay planes disponibles para contratar." /> : <>
      <label className="billing-select-label" htmlFor="target-plan">Nuevo plan</label>
      <select className="billing-select" id="target-plan" value={selected} onChange={(event) => { setSelected(event.target.value); setError(""); }}><option value="">Selecciona un plan</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatBytes(item.storageLimitBytes)} · hasta {item.userLimit} usuarios</option>)}</select>
      {chosen && <BillingRows rows={[["Almacenamiento del plan nuevo", formatBytes(chosen.storageLimitBytes)], ["Precio", price(chosen)]]} />}
      <p className="billing-reference-note">El servidor valida el cambio frente al uso actual. Si el espacio ocupado supera el límite, la solicitud será rechazada.</p>
      {chosen && chosen.priceMonthly > 0 && current.status !== "loading" && chosen.id !== current.currentPlanId
        ? <PaymentForm key={chosen.id} onSubmit={submit} submitLabel="Enviar solicitud de cambio" disabled={busy} error={error} />
        : <>{chosen && chosen.priceMonthly > 0 && chosen.id === current.currentPlanId && <p className="billing-reference-note">{alreadyActiveNote}</p>}{error && <Notice title="No se pudo enviar la solicitud" message={error} />}<button className="button button-primary billing-primary" onClick={() => submit()} disabled={!chosen || busy || current.status === "loading"}>{busy ? "Enviando…" : "Enviar solicitud de cambio"}</button></>}
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
