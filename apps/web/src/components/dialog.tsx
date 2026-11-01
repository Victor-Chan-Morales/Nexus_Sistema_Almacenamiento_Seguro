"use client";

import { type ReactNode, useEffect, useRef } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Mueve el foco dentro del diálogo al pulsar Tab o Shift+Tab, para que no escape hacia el fondo. */
function trapTab(event: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Diálogo modal accesible compartido (SPEC-205 y SPEC-207).
 * Escape y clic en el fondo cierran salvo que `disabled` esté activo (operación en curso).
 * Al abrir enfoca el primer elemento; al cerrar devuelve el foco a quien lo abrió.
 */
export function Dialog({
  labelledBy,
  onClose,
  disabled = false,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !disabled) {
        onCloseRef.current();
      } else if (event.key === "Tab") {
        trapTab(event, panelRef.current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [disabled]);

  function closeIfAllowed() {
    if (!disabled) onCloseRef.current();
  }

  return (
    <div
      className="drive-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeIfAllowed();
      }}
    >
      <section ref={panelRef} className="drive-modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <button type="button" className="drive-modal-close" onClick={closeIfAllowed} disabled={disabled} aria-label="Cerrar">
          ×
        </button>
        {children}
      </section>
    </div>
  );
}
