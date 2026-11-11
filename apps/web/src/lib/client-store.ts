/**
 * Suscripción vacía para `useSyncExternalStore`: el valor que se lee del navegador
 * (almacenamiento del navegador, fecha local) se toma en cada render sin escuchar cambios.
 */
export function noopSubscribe() {
  return () => {};
}
