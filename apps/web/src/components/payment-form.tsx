"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { PaymentCardPayload } from "@/lib/api/types";

type PaymentFormProps = {
  onSubmit: (payment: PaymentCardPayload) => Promise<void>;
  submitLabel: string;
  disabled?: boolean;
  error?: string;
};

// Validación solo de formato para dar respuesta rápida; el backend decide.
function validate({ cardNumber, holderName, expiry, cvv }: PaymentCardPayload) {
  const digits = cardNumber.replace(/\s/g, "");
  if (!/^\d{13,19}$/.test(digits)) return "Ingresa un número de tarjeta válido (solo dígitos).";
  if (holderName.trim().length === 0 || holderName.trim().length > 100) return "Ingresa el nombre del titular (hasta 100 caracteres).";
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry.trim())) return "El vencimiento debe tener el formato MM/AA.";
  if (!/^\d{3}$/.test(cvv)) return "El CVV debe tener 3 dígitos.";
  return "";
}

export function PaymentForm({ onSubmit, submitLabel, disabled = false, error }: PaymentFormProps) {
  const [cardNumber, setCardNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [localError, setLocalError] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payment: PaymentCardPayload = { cardNumber: cardNumber.trim(), holderName: holderName.trim(), expiry: expiry.trim(), cvv };
    const problem = validate(payment);
    setLocalError(problem);
    if (problem) return;
    setSending(true);
    try {
      await onSubmit(payment);
    } finally {
      // Los datos sensibles no se conservan, tenga o no éxito el envío.
      setCardNumber("");
      setCvv("");
      setSending(false);
    }
  }

  const shownError = localError || error;
  const busy = disabled || sending;

  return <form className="payment-form" onSubmit={handleSubmit} noValidate autoComplete="off">
    <div className="billing-warning"><span aria-hidden="true">△</span><div><b>Simulación: usa solo estas tarjetas de prueba</b>
      <p>4242 4242 4242 4242 (aprobada)<br />4000 0000 0000 0002 (rechazada)</p>
      <p>No uses tarjetas reales: no se procesa ningún cobro.</p></div></div>
    <div className="payment-form-field"><label htmlFor="payment-card-number">Número de tarjeta</label>
      <input id="payment-card-number" name="nx-test-card-number" inputMode="numeric" autoComplete="off" maxLength={23} placeholder="4242 4242 4242 4242" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} disabled={busy} /></div>
    <div className="payment-form-field"><label htmlFor="payment-holder">Titular</label>
      <input id="payment-holder" name="nx-test-card-holder" autoComplete="off" maxLength={100} placeholder="Nombre del titular" value={holderName} onChange={(event) => setHolderName(event.target.value)} disabled={busy} /></div>
    <div className="payment-form-row">
      <div className="payment-form-field"><label htmlFor="payment-expiry">Vencimiento (MM/AA)</label>
        <input id="payment-expiry" name="nx-test-card-expiry" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="MM/AA" value={expiry} onChange={(event) => setExpiry(event.target.value)} disabled={busy} /></div>
      <div className="payment-form-field"><label htmlFor="payment-cvv">CVV</label>
        <input id="payment-cvv" name="nx-test-card-cvv" type="password" inputMode="numeric" autoComplete="off" maxLength={3} placeholder="123" value={cvv} onChange={(event) => setCvv(event.target.value)} disabled={busy} /></div>
    </div>
    {shownError && <div className="billing-error-box payment-form-error" role="alert"><p>{shownError}</p></div>}
    <button type="submit" className="button button-primary billing-primary" disabled={busy}>{sending ? "Procesando…" : submitLabel}</button>
  </form>;
}
