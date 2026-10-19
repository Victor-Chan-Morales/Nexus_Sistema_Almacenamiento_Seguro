"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/session";

export type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/**
 * Carga un recurso de la API con estados de carga, error y reintento.
 * `fetcher` debe estar memorizado (useCallback). Un 401 limpia la sesión y redirige a /sesion-vencida.
 */
export function useLoad<T>(fetcher: (signal: AbortSignal) => Promise<T>, enabled = true, errorMessage = "No pudimos cargar la información. Inténtalo de nuevo.") {
  const { failSession } = useSession();
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetcher(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (failSession(error)) return;
        setState({ status: "error", message: error instanceof ApiError && error.status === 0 ? error.message : errorMessage });
      });
    return () => controller.abort();
  }, [fetcher, enabled, attempt, failSession, errorMessage]);

  const reload = useCallback(() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }, []);
  const set = useCallback((next: Load<T>) => setState(next), []);
  return { state, reload, set };
}
