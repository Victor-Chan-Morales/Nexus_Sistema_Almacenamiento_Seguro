# SPEC-403: PANTALLA DE AUDITORÍA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (Frontend / Integración) |
| **Responsable Principal** | Víctor Chán Morales |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/app/auditoria/`, `apps/web/src/lib/api/audit.ts` (nuevo) |
| **Requisitos Vinculados** | RF-012 |
| **Dependencias** | SPEC-402 (API) y SPEC-106 (`getMembers`, para nombres). Puede avanzar con un mock. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 1.5 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

Reemplazar el `PlaceholderPage` de `/auditoria` por la bitácora real del administrador.

---

## 3. Fuera de Alcance (YAGNI)

- Exportar, buscar por texto y verificar la integridad de la cadena.
- Mostrar nombres de archivo (el evento no los guarda).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Bitácora
  Dado un tenant_admin en /auditoria
  Entonces ve una tabla con fecha (formatIsoDate), actor (nombre resuelto con la lista de miembros; si no se encuentra, "Usuario"), acción en español con insignia de color y el recurso

Escenario 2: Filtro
  Entonces puede filtrar por tipo de acción sobre lo ya cargado (filtro solo visual)

Escenario 3: Cargar más
  Dado nextBefore no nulo
  Entonces "Cargar más" pide la siguiente página con before=nextBefore

Escenario 4: Colaborador
  Entonces ve "Solo los administradores consultan la auditoría" y no se llama a la API

Escenario 5: Estados
  Entonces existen cargando, vacío ("Aún no hay actividad registrada"), error con reintento y datos
```

---

## 5. Contrato de API

Consume `CONTRACTS.md` v0.5 ("Auditoría"). `getAuditEvents({ limit, before })` en `lib/api/audit.ts`; tipos en `lib/api/types.ts`.

---

## 6. Datos y Esquema

No aplica.

---

## 7. Interfaz de Usuario

- Etiquetas en español por `action` (p. ej. `FILE_UPLOAD` → "Archivo subido", `AUTH_LOGIN` → "Inicio de sesión", `MEMBER_ADDED` → "Miembro agregado", `FILE_PURGE` → "Archivo eliminado definitivamente", `PLAN_RENEWED` → "Plan renovado"). Un `action` desconocido se muestra con su código.
- Insignias semánticas por familia (autenticación, archivos, equipo, plan) con los tokens de `docs/IDENTIDAD_VISUAL.md`.

---

## 8. Diseño Técnico

- El mapeo `actorId → nombre` es solo presentación (lista de miembros ya cargada); no se autoriza nada en el cliente.

---

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: `lib/api/audit.ts` y tipos.
- [ ] **T2 (45 min)**: tabla con etiquetas, insignias y resolución de actores.
- [ ] **T3 (25 min)**: filtro, "Cargar más" y estados; vista de `colaborador`.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Verificación |
|---|---|---|
| Escenarios 1–5 | Manual | Iniciar sesión, subir, descargar, agregar un miembro y comprobar que cada acción aparece |

---

## 11. Impacto en Documentación

- [ ] `ENTS_REGISTRY.md` y `docs/FIGMA_MAP.md`: `/auditoria` conectada.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Campos del contrato (`occurredAt`, sin `metadata`); nombres desde la lista de miembros; vista de `colaborador`; paginación. |
