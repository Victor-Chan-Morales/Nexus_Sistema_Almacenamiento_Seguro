# ASIGNACIONES Y PLAN DE TRABAJO — CORTE DEL 80%

> **Equipo:** Víctor Chán Morales (coordinador, integración) · Sebastián (IAM) · Miguel (Files & Storage) · Anthony (Billing & Audit).
> **Hito:** corte del 80% el **viernes 30 de octubre de 2026**. El alcance 100% va a la primera semana de noviembre.
> **Capacidad confirmada:** ~7 h por persona hasta el viernes (28 h en total).
> **Fuentes:** `specs/README.md` (backlog), `docs/decisions/ADR-007-decisiones-corte-80.md`, `CONTRACTS.md` v0.5 (borrador).
> **Actualizado:** 2026-10-27. Reemplaza los repartos anteriores.

---

## 1. Qué entra y qué no

Con 28 h **no entra todo**. Se prioriza lo que el curso exige de forma explícita (roles, recuperación de contraseña, historial y renovación de pagos) y la auditoría, que la propuesta vende como diferenciador.

| Entra (P1, ~23 h de implementación) | Pasa a P2 (solo si sobra tiempo) |
|---|---|
| Roles y alta de miembros: 101, 102, 104, 106 | **Papelera completa: 202, 203, 204, 205** |
| Recuperación de contraseña: 103, 105 | Versiones: 206, 207 |
| Facturación: 301, 302, 303 | Perfil real: 601 |
| Auditoría: 401, 402, 403, 405 | |

Las ~5 h restantes de la capacidad son de Víctor: aprobar contrato y specs, revisar ~15 PR y el recorrido de punta a punta. **La papelera pasa a P2 y se declara en la exposición** (el explorador seguirá sin poder mover archivos a la papelera).

## 2. Reparto (a confirmar por cada persona)

| Persona | Tareas P1 | Horas |
|---|---|:---:|
| **Sebastián** | 101 (2.0) → 103 T3–T5 (2.3) → 102 (2.5) → 104 (1.0) | **7.8** |
| **Miguel** | 105 (1.5) · 106 (1.5) · 303 (1.5) · 402 (1.5) · 405 Files (0.5) | **6.5** |
| **Anthony** | 401 (2.5) → 301 (2.0) → 302 (1.5) · 102-T6 (0.3) · 405 Billing (0.3) | **6.6** |
| **Víctor** | Aprobar contrato y specs (0.5) · 103-T2 (0.7) · 405 IAM (0.5) · 403 (1.5) · revisión de PR (~3) · recorrido de punta a punta (~2) | **~8.2** |
| **Total** | | **~29** (1 h por encima de las 28 h) |

**Por qué este reparto**
- IAM es la ruta crítica: Sebastián ya llega a 7.8 h, así que Víctor se queda con el outbox (103-T2) y con los eventos de auditoría de IAM.
- Miguel tiene holgura en su dominio y toma las pantallas de recuperación, miembros e historial de facturación, y la consulta de auditoría (402). Trabaja contra el contrato v0.5 con datos simulados hasta que las APIs estén.
- **Si Sebastián se retrasa**, lo primero que se recorta es 104: SPEC-106 sale solo con el formulario de alta y sin la tabla.
- **Documentos 701/702 (requisitos con casos de uso y diagramas UML): borrador asistido ya redactado** (`docs/entregables/REQUISITOS_CASOS_USO.md` y `DIAGRAMAS_UML.md`). Víctor necesita ~1–1.5 h para revisarlo y al cierre actualizar los estados 🟡/⛔ según lo que haya entrado (no incluidas en las ~8.2 h de Víctor).

## 3. Reglas de colisión (con excepciones acordadas)

- Sebastián: `modules/iam/`. Miguel: `modules/files/` y `modules/storage/`. Anthony: `modules/billing/` y `modules/audit/`. Víctor: `apps/web/`, `database/migrations/`, documentos raíz y revisión de PR.
- **Excepciones, solo para estas specs:**
  1. Anthony edita `modules/integration/subscription.coordinator.ts` y `subscriptions.controller.ts` (SPEC-301/302).
  2. Anthony registra la política `user-limit` en `modules/billing/registration/` (SPEC-102 T6).
  3. **Miguel edita `modules/audit/`** para SPEC-402, **después** de que SPEC-401 esté mergeado.
  4. **Víctor edita `modules/iam/`** para 103-T2 (outbox) y 405 (eventos de IAM).
  5. **Miguel edita `apps/web/`** para 105, 106, 303 (y 205/207 si hay tiempo), acordado con Víctor.
- Cada dueño añade **sus propios** `@Roles` y eventos de auditoría (matriz: ADR-007 §4; eventos: SPEC-405).
- Cambios de contrato: avisar a Víctor antes de tocar `CONTRACTS.md`.

## 4. Orden de entrega (dependencias reales)

```
Miércoles 28
  Víctor     Aprueba CONTRACTS v0.5 y specs ► 103-T2 (outbox) ► aplica la migración  [desbloquea]
  Sebastián  101 (RolesGuard) ► 103 T3–T5
  Anthony    401 (AuditModule) ► 301
  Miguel     105 y 106 contra datos simulados

Jueves 29   ── 12:00: se recorta todo lo no iniciado ──   demo interna 8:00 PM
  Sebastián  102 ► 104
  Anthony    302 ► 102-T6 ► 405 Billing
  Miguel     402 (tras 401) ► 303 (tras 301) ► 405 Files
  Víctor     403 (tras 402) ► 405 IAM (tras 102 y 103) ► revisión de PR

Viernes 30  ── hasta mediodía ──
  Todos      Correcciones del recorrido
  Víctor     Recorrido de punta a punta y congelación
  Miguel     P2 en este orden si todo está verde: 202 y 203, 205, 204, 206, 207
```

**Dependencias que no se pueden saltar:** 101 antes de 102, 104, 302 y 402 · 103-T2 antes de 103 T3–T5 y de 102 · 401 antes de 402 y 405 · 301 antes de 302 y 303 · la migración del outbox (**ya creada y verificada**: `20261027090000_allow_password_reset_outbox_kinds.sql`) aplicada en cada entorno antes de probar 103.

## 5. Alcance 100% (primera semana de noviembre)

- **Sebastián:** SPEC-501 (endpoints de Super Admin).
- **Miguel:** SPEC-208 (ZIP), SPEC-209 (enlaces compartidos) y lo que haya pasado de P2.
- **Anthony:** SPEC-404 (verificación de la cadena de hashes).
- **Víctor:** SPEC-003 (CI), 502, 602, 603, 703, 704 y 705.
- **Fuera de alcance, y se declara en la exposición:** papelera (si no entra), carpetas de equipo (RF-006), selección de modelo de despliegue (RF-014), MFA/TOTP, rol Auditor, restauración de versiones.

## 6. Política de pull requests

1. Ningún código entra a `main` sin PR; solo Víctor aprueba y mergea.
2. PR ≤ 400 líneas; plantilla `.github/pull_request_template.md` (única).
3. Antes de pedir revisión: `npm run build:api && npm run build:web` y `npm run test:api` (cobertura: `npm run test:cov`).
4. Cada PR declara la spec (`SPEC-XXX`) y marca si toca una zona protegida.
