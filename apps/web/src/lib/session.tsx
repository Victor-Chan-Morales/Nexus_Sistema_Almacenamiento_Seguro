"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { logout, refreshSession } from "@/lib/api/iam";
import type { LoginResponse } from "@/lib/api/types";

/** La sesión vive solo en memoria: el access token nunca se escribe en localStorage ni sessionStorage. */
export type Session = LoginResponse;

type SessionContextValue = {
  session: Session | null;
  /** true mientras se intenta restaurar la sesión con la cookie HttpOnly de refresh. */
  restoring: boolean;
  expired: boolean;
  signIn: (next: Session) => void;
  signOut: () => Promise<void>;
  /** Devuelve true si el error era una sesión vencida (401) y ya se limpió el estado. */
  failSession: (error: unknown) => boolean;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; expired: boolean; restoring: boolean }>({ session: null, expired: false, restoring: true });

  useEffect(() => {
    const controller = new AbortController();
    refreshSession({ signal: controller.signal })
      .then((session) => setState({ session, expired: false, restoring: false }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState({ session: null, expired: false, restoring: false });
      });
    return () => controller.abort();
  }, []);

  const signIn = useCallback((session: Session) => setState({ session, expired: false, restoring: false }), []);
  const signOut = useCallback(async () => {
    try { await logout(); } catch { /* La sesión local se limpia aunque la API no responda. */ }
    setState({ session: null, expired: false, restoring: false });
  }, []);
  const failSession = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      setState({ session: null, expired: true, restoring: false });
      return true;
    }
    return false;
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut, failSession }), [state, signIn, signOut, failSession]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession debe usarse dentro de SessionProvider.");
  return context;
}

/** Límite de autenticación del cliente. No sustituye la validación de sesión y tenant que hace la API. */
export function RequireSession({ children }: { children: (session: Session) => React.ReactNode }) {
  const { session, restoring, expired } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!restoring && !session) router.replace(expired ? "/sesion-vencida" : "/login");
  }, [session, restoring, expired, router]);
  return session ? <>{children(session)}</> : null;
}

export function initialsOf(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
