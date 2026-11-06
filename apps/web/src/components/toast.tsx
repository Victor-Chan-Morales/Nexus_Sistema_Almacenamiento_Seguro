"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Kind = "success" | "error";
type Notify = (kind: Kind, message: ReactNode) => void;
const ToastContext = createContext<Notify | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; kind: Kind; message: ReactNode }[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const close = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<Notify>((kind, message) => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, kind, message }]);
    if (kind === "success") timers.current.set(id, setTimeout(() => close(id), 5000));
  }, [close]);

  return <ToastContext.Provider value={notify}>
    {children}
    <div className="toast-stack">
      {toasts.map(({ id, kind, message }) => <div key={id} className={`toast toast-${kind}`}>
        <div role={kind === "error" ? "alert" : "status"}>{message}</div>
        <button type="button" aria-label="Cerrar aviso" onClick={() => close(id)}>×</button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("useToast debe usarse dentro de ToastProvider.");
  return notify;
}

export function LoadingIndicator({ children }: { children: ReactNode }) {
  return <p className="loading-indicator" role="status"><span aria-hidden="true" />{children}</p>;
}
