# Evidencia SPEC-305: pago simulado con tarjetas de prueba

Verificación ejecutada el 2026-11-10 sobre la rama `feat/305-pago-simulado-tarjetas`: API compilada (`apps/api/dist/main.js`), web en modo desarrollo (`npm run dev:web`) y una base PostgreSQL temporal (`nexus_305_smoke`), creada con las migraciones del repositorio y poblada con `npm run seed:demo`. No se usó la base de desarrollo compartida.

Las capturas muestran solo las tarjetas de prueba de la spec. No contienen credenciales ni datos reales.

## Escenario 10: pantallas

Chromium headless con Playwright, contra la web y la API reales. Escritorio a 1280 px y móvil a 390 px.

| Captura | Qué muestra | Escenario |
|---|---|---|
| `c01-confirmar-plan-pago.png` | Confirmar Plan Team (de pago, no contratado): formulario, las dos tarjetas de prueba y el aviso de simulación. Sin la frase "No se solicitan datos de tarjeta". | 10 |
| `c02-tarjeta-no-prueba.png` | Tarjeta `1111 1111 1111 1111`: error en línea "Solo se aceptan tarjetas de prueba…", sin navegar. | 3, 10 |
| `c03-fallida-tarjeta-rechazada.png` | Tarjeta `4000 0000 0000 0002`: redirección a `/suscripcion/fallida?plan=…&motivo=tarjeta` con el texto de tarjeta rechazada. | 2, 10 |
| `c04-exito-tarjeta-aprobada.png` | Tarjeta `4242 4242 4242 4242`: contratación aprobada. | 1 |
| `c05-reactivar-plan-vigente.png` | Confirmar el plan que ya está vigente: sin formulario y con la nota "Este plan ya está activo: no se solicita tarjeta." | 5 |
| `c06-plan-gratuito.png` | Plan Demo (US$0): botón simple, sin formulario. | 5 |
| `c07-renovar-rechazada.png` | Renovar con tarjeta rechazada: error en línea dentro del formulario, sin cambiar de ruta. El historial no registra el intento rechazado. | 4, 10 |
| `c08-cambiar-plan-pago.png` | Cambiar a Plan Business (de pago): formulario en la pantalla de cambio. | 10 |
| `c09-cambiar-plan-vigente.png` | Cambiar al plan vigente: sin formulario y con la nota. | 5 |
| `m01-confirmar-plan-pago-movil.png` | Confirmar en 390 px: formulario sin scroll horizontal. | 10 |
| `m02-renovar-rechazada-movil.png` | Renovar rechazada en 390 px: sin scroll horizontal. | 4, 10 |

**Comprobaciones automáticas, 12 de 12 en verde:**
- Formulario y aviso presentes en un plan de pago.
- Ausencia de la frase antigua sobre tarjetas.
- Tarjeta no aprobada: error en línea, sin navegar.
- Rechazo: redirección con `motivo=tarjeta`.
- Aprobada: llega a `/suscripcion/exito`.
- Reactivación y plan gratuito: sin formulario.
- Renovación rechazada: sin redirección.
- Cambio al plan vigente: sin formulario.
- Sin número de tarjeta en la URL, en `localStorage` ni en `sessionStorage`.
- Sin scroll horizontal en 390 px.

**Errores de consola esperados:** 401 de `POST /auth/refresh` antes de iniciar sesión; 422 `TEST_CARD_REQUIRED`; 402 de la activación y de la renovación rechazadas. Hay además un 404 de `/favicon.ico`, que la aplicación no sirve; no está relacionado con este cambio.

## Prueba de humo de la API

Contra la base temporal, 12 casos en verde:

1. Login del administrador.
2. Activar Team con `4242` → 201, la suscripción cambia.
3. Activar Business con `4000` → 402 `PAYMENT_DECLINED`, el plan no cambia.
4. Activar Business con `1111` → 422 `TEST_CARD_REQUIRED`.
5. Activar Business sin `payment` → 400 `VALIDATION_ERROR`.
6. Vencimiento `01/20` → 400 "La tarjeta está vencida".
7. CVV de 2 dígitos → 400.
8. Reactivar Team sin tarjeta → misma suscripción.
9. Renovar con `4000` → 402; la vigencia no cambia.
10. Renovar con `4242` → 200; la vigencia cambia.
11. Renovar sin cuerpo en un plan de pago → 400.
12. Plan Demo con `payment` mal formado → 400; con `payment` válido → se ignora y `card_last4` queda `NULL`.

**Auditoría:** dos eventos `PAYMENT_DECLINED` con resultado `failure`, uno por cada rechazo.

**Datos sensibles:** ni el volcado de la base, ni el log del servidor, ni las respuestas contienen el número de tarjeta, el titular ni el CVV. La única columna con datos de tarjeta es `billing.billing_operation.card_last4`, con los cuatro últimos dígitos de la tarjeta aprobada.

**Errores 5xx en el log del servidor:** ninguno.

## Lo que no se comprobó

- La ruta de cuota excedida (`STORAGE_QUOTA_EXCEEDED` → `/suscripcion/cambio-rechazado`) no se recorrió en el navegador: requiere archivos que superen el límite del plan. La API está cubierta por pruebas unitarias.
- Los planes gratuitos y la reactivación se cubren en la API con pruebas unitarias y con el caso 8 de la prueba de humo.

## Desviaciones y notas

- El botón "Cancelar" del formulario de renovación se ve como botón con borde, no como enlace. Es cosmético y queda pendiente.
- Las capturas usan el servidor de desarrollo de Next.js, que muestra un indicador "N" en la esquina inferior izquierda. No forma parte de la aplicación.
- Las capturas son posteriores a la corrección de reactivar el plan vigente (commit `abff87a`).
- Los mensajes de validación del DTO para mes 13 o CVV de 2 dígitos llegan al usuario como "Datos ausentes o mal formados", porque el filtro de errores no reenvía mensajes sin `code`. El formulario valida el formato antes de enviar, así que el usuario normalmente no llega a ese caso.
