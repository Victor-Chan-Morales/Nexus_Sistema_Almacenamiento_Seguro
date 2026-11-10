# SPEC-217: PANTALLAS DE COMPARTIR

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/`, `apps/web/src/app/compartido/` |
| **Requisitos Vinculados** | RF-010, RF-011 |
| **Dependencias** | SPEC-209, SPEC-216 |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Crear, copiar y revocar enlaces desde el explorador, y darle a quien recibe un enlace una página para descargar.

## 3. Fuera de Alcance

- Código QR, envío por correo y vista previa.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Crear
  Dado un archivo en el explorador
  Cuando pulsa "Compartir", elige 1, 7 o 30 días y opcionalmente una contraseña
  Entonces ve el enlace completo con un botón "Copiar"
  Y un aviso indica que no se volverá a mostrar

Escenario 2: Lista
  Entonces el diálogo muestra los enlaces con vencimiento, protección y estado
  Y solo los activos ofrecen "Revocar", con confirmación

Escenario 3: Página pública
  Cuando alguien abre /compartido/<token> sin sesión
  Entonces ve nombre, tamaño, vencimiento y "Descargar"

Escenario 4: Con contraseña
  Entonces pide la contraseña sin mostrar el nombre
  Y descarga si es correcta, o muestra un error si no

Escenario 5: Demasiados intentos
  Dado 429 → indica esperar antes de reintentar

Escenario 6: No disponible
  Dado 404 → muestra "Este enlace no está disponible", sin explicar la causa

Escenario 7: Sin datos en la URL
  Entonces el token no se envía a terceros: la página no carga recursos externos
```

## 5. Contrato de API

Consume SPEC-209 y SPEC-216.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

- **Ruta nueva:** `/compartido/[token]`, sin `AppShell` ni `RequireSession`.
- **Modal:** `components/share-dialog.tsx`, con `Dialog` existente.
- **Estados:** cargando, vacío ("Aún no hay enlaces"), error, datos y copiado.
- **URL del enlace:** `window.location.origin + /compartido/<token>`.
- Los nombres de archivo se muestran como texto, sin `dangerouslySetInnerHTML`.

## 8. Diseño Técnico

- `lib/api/files.ts`: `createShareLink`, `listShareLinks`, `revokeShareLink`.
- `lib/api/public-share.ts` (nuevo): `getPublicShareLink`, `downloadPublicShareLink`, sin `accessToken`.
- El token vive solo en el estado del diálogo; no se guarda en `localStorage`.
- Reutilizar la lógica de descarga actual (`downloadSelected`) para crear el `Blob`.
- Fallback de copiado si `navigator.clipboard` no existe (HTTP sin TLS).

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: Clientes y tipos.
- [ ] **T2 (60 min)**: Diálogo de compartir.
- [ ] **T3 (50 min)**: Página pública.
- [ ] **T4 (20 min)**: Prueba manual.

**Archivos permitidos:** `components/share-dialog.tsx`, `app/compartido/[token]/page.tsx`, `lib/api/public-share.ts` (nuevos), `components/file-browser-live.tsx` (solo el botón y el diálogo), `lib/api/files.ts`, `lib/api/types.ts`, `lib/api/client.ts` (solo el parámetro de método y cuerpo de `apiRequestBlob`, necesario para la descarga pública por `POST`; ver §13), `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–7 | Manual y `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-10 | Claude Code (implementación) | Excepción D1 confirmada antes de implementar: `lib/api/client.ts` se añade a "Archivos permitidos". `apiRequestBlob` acepta un `RequestInit` opcional (por defecto `GET`) porque la descarga pública de SPEC-216 es un `POST` con cuerpo JSON. Las llamadas existentes no cambian. |
