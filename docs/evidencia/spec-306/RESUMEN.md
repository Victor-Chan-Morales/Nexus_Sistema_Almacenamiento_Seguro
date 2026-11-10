# Evidencia SPEC-306: comprobantes descargables

Verificación ejecutada el 2026-11-10 sobre la rama `feat/306-comprobantes`. El código verificado es el commit `e6d2f62` (merge con `origin/main`). El commit `a3fcba7` después solo cambia CSS.

Se usaron la API en modo desarrollo (`npm run dev:api`, puerto 3201) y la web en modo desarrollo (`next dev`, puerto 3200), contra una base PostgreSQL dedicada `nexus_qa_306`. La base se creó con las migraciones del repositorio y se pobló con `npm run seed:demo`. No se usó la base de desarrollo compartida.

Las capturas solo muestran datos de prueba: la tarjeta `4242 4242 4242 4242` y las cuentas demo. No contienen credenciales.

## Capturas

| Captura | Qué muestra | Escenario |
|---|---|---|
| `01-historial-306.png` | Historial de `/suscripcion` con la columna "Comprobante" en cada fila | Historial (spec §7) |
| `02-comprobante-con-tarjeta-306.png` | Comprobante de una operación Team: leyenda "Simulación: sin valor fiscal", botón "Imprimir o guardar PDF" y fila "•••• 4242" | E1, E2 |
| `03-impresion-emulada-306.png` | Vista con emulación de medios `print`: sin logo, sin botón y sin enlace de volver. La leyenda sigue visible | E3 |
| `04-movil-375px-306.png` | Mismo comprobante a 375 px de ancho, sin scroll horizontal | Spec §7 |
| `05-comprobante-demo-sin-tarjeta-306.png` | Operación Demo (US$0): no hay fila de tarjeta | E5 |
| `06-colaborador-403-306.png` | Colaborador: mensaje "No tienes permiso para ver los comprobantes de la organización", sin datos del comprobante | E4 |

## Resultados

| Verificación | Resultado |
|---|---|
| Pruebas automáticas de la API (`npm run test:api`), en `e6d2f62` | 64 suites, 1163 pruebas en verde |
| QA por HTTP | 16/16 |
| Aislamiento entre organizaciones | 2/2: la operación ajena responde `404 NOT_FOUND` y no aparece en el historial de la otra organización |
| QA de navegador (Playwright, Chromium) | 22/22 |
| Errores de consola | Solo los esperados de las pruebas negativas: un 401 del refresh antes de iniciar sesión, un 404 del id inexistente y un 403 del colaborador |

## Lo que no se verificó

- **Impresión real del navegador** (Ctrl+P o el botón "Imprimir o guardar PDF"). El diálogo nativo bloquea la automatización de Chrome. La impresión se verificó con la emulación de medios `print` de Playwright.
- **PDF resultante.** No se revisó el archivo que genera el navegador.
- **Cotejo con Figma.** `docs/FIGMA_MAP.md` no tiene frame para el comprobante.

## Decisiones y desviaciones

- `receiptNumber` = `NX-` + el UUID sin guiones en mayúsculas (decisión D2, confirmada el 2026-11-10).
- Un `:id` que no es UUID responde `404 NOT_FOUND` sin consultar la base (decisión D3).
- Ancho móvil de 375 px. SPEC-305 usó 390 px.
- Durante la verificación se corrigió la alineación del enlace "Comprobante" dentro de la tabla del historial (commit `a3fcba7`).

## Cómo reproducir

1. `docker compose up -d postgres mailpit seaweedfs`. Crear una base dedicada, aplicar las migraciones de `database/migrations/` y ejecutar `POSTGRES_DB=<base> npm run seed:demo`.
2. Levantar la API: `API_PORT=3201 WEB_URL=http://localhost:3200 POSTGRES_DB=<base> npm run dev:api`.
3. Levantar la web: `cd apps/web && NEXT_PUBLIC_API_BASE_URL=http://localhost:3201/api npx next dev -p 3200`.

Nota: Next no lee el `.env` de la raíz. Sin `NEXT_PUBLIC_API_BASE_URL` en el entorno de la web, la pantalla de login muestra "Falta configurar NEXT_PUBLIC_API_BASE_URL".

Los scripts de Playwright y de QA por HTTP usados aquí no están en el repositorio.
