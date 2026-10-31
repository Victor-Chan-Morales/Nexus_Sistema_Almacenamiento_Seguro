/**
 * Suscripción vacía para `useSyncExternalStore`: el valor que se lee del navegador
 * (almacenamiento demo, fecha local) se toma en cada render sin escuchar cambios.
 */
export function noopSubscribe() {
  return () => {};
}
