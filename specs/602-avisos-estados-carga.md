# SPEC-602: AVISOS Y ESTADOS DE CARGA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N0 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/` |
| **Requisitos Vinculados** | RNF-009 |
| **Dependencias** | Ninguna |
| **Prioridad** | P2 |
| **Estimación** | 1 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Mensajes emergentes de éxito o error y estados de carga uniformes.

## 3. Fuera de Alcance

- Librerías nuevas y centro de notificaciones.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Aviso de éxito
  Cuando sube, restaura o elimina
  Entonces aparece un aviso que se cierra solo en 5 segundos, con opción de cerrar

Escenario 2: Aviso de error
  Entonces permanece hasta cerrarlo y no sustituye los errores en formularios

Escenario 3: Accesibilidad
  Entonces se anuncia con role="status" o role="alert"

Escenario 4: Carga
  Entonces explorador, papelera, auditoría y suscripción usan el mismo indicador
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

`ToastProvider` en `app/layout.tsx`, con los tokens de `docs/IDENTIDAD_VISUAL.md`.

## 8. Diseño Técnico

Contexto de React con `useToast()`. Sin datos sensibles en los mensajes.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: Proveedor y componente.
- [ ] **T2 (30 min)**: Aplicar en las pantallas indicadas.

**Archivos permitidos:** `components/toast.tsx` (nuevo), `app/layout.tsx`, `app/globals.css`, las pantallas del escenario 4.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–4 | Manual; `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

Ninguno.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
