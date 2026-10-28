# BACKLOG GENERAL DE ESPECIFICACIONES — NEXUS

> **Sistema de Almacenamiento Seguro Híbrido (PaaS/STaaS)**
> Catálogo de todo el trabajo pendiente. **Corte del 80%: viernes 30 de octubre de 2026** (decisión del coordinador, 2026-10-27). El alcance "100%" queda para la primera semana de noviembre.
>
> - **Decisiones vigentes:** `docs/decisions/ADR-007-decisiones-corte-80.md`.
> - **Contratos:** `CONTRACTS.md` **v0.5 (aprobada el 2026-10-28)**. Las PR ya pueden implementar sus rutas, una vez que Víctor apruebe la spec correspondiente.
> - **Numeración de requisitos:** la de la propuesta (RF-001…RF-016, RNF-001…RNF-011). Lo que exige el curso y la propuesta no numera se cita como "Curso §4.1/§4.2".
> - **Estado:** todas las specs reescritas el 2026-10-27 quedan **En revisión** hasta que Víctor las marque Aprobada.

---

## Prioridades del corte del 80%

**Capacidad real confirmada (2026-10-27): ~7 h por persona hasta el viernes = 28 h.** Esa cifra define el corte.

| Prioridad | Significado | Specs |
|---|---|:---:|
| **P1** | Imprescindible: requisitos obligatorios del curso (roles, recuperación de contraseña, historial y renovación) más la auditoría (RF-012) | 15 |
| **P2** | Solo si sobra tiempo; si no, pasa al 100% y se declara en la exposición. **Incluye la papelera completa** (202–205) y versiones (206, 207) y perfil (601) | 7 |

**Cuentas:** las tareas P1 de las specs suman ~23 h de implementación (101 2.0 · 102 2.5 · 103 3.0 · 104 1.0 · 105 1.5 · 106 1.5 · 301 2.0 · 302 1.5 · 303 1.5 · 401 2.5 · 402 1.5 · 403 1.5 · 405 1.3). Las ~5 h restantes de los 28 h son de Víctor: aprobar contrato y specs, revisar ~15 PR y el recorrido de punta a punta. Las specs 701/702 (documentos) **no tienen horas asignadas** (ver `docs/equipo/asignaciones.md`). P2 suma ~10 h y solo entra con holgura.

---

## 0xx: Fundación, Infraestructura y Criptografía

| ID | Especificación | Nivel | Responsable | Requisitos | Prioridad | Estado |
|---|---|:---:|---|---|:---:|:---:|
| `SPEC-001` | Corrección del cálculo recursivo de carpetas y bytes | N0 | Víctor | RF-007, RF-013 | — | ✅ Hecho (sin commit; contrato documentado en v0.5) |
| `SPEC-002` | ADR-006: cifrado `node:crypto` AES-256-GCM | N1 | Víctor | RF-004, RF-005, RNF-003 | — | ✅ Hecho (ADR-006 corregido el 2026-10-27) |
| `SPEC-003` | Integración continua (GitHub Actions) | N1 | Víctor | Calidad | 100% | Pendiente |

> **Nota SPEC-002:** ADR-006 corregido (jerarquía de llaves real, formato del objeto, sin columnas `iv`/`auth_tag`) y `ARCHITECTURE.md`/`BUSINESS_RULES.md` alineados. Quedan como limitaciones declaradas: sin streaming, **sin rotación de llaves** (el descifrado ignora `kek_id`) y sin pruebas dedicadas de `FilesCryptoService`.

## 1xx: IAM, Roles y Miembros

| ID | Especificación | Nivel | Responsable | Requisitos | Prioridad | Estado |
|---|---|:---:|---|---|:---:|:---:|
| `SPEC-101` | `@Roles` y `RolesGuard` | N2 | Sebastián | RF-003 | P1 | En revisión |
| `SPEC-102` | Alta de miembros `POST /organizations/members` | N2 | Sebastián (+Anthony T6) | RF-003, Curso §4.1 | P1 | En revisión |
| `SPEC-103` | Recuperación de contraseña + outbox generalizado + revocación de sesiones | N2 | Sebastián (T2: Víctor) | Curso §4.1, RNF-004 | P1 | En revisión |
| `SPEC-104` | Listado de miembros `GET /organizations/members` | N2 | Sebastián | RF-003 | P1 | En revisión |
| `SPEC-105` | Frontend: recuperar contraseña | N1 | Miguel (delegado) | Curso §4.1 | P1 | En revisión |
| `SPEC-106` | Frontend: miembros en `/configuracion` | N1 | Miguel (delegado) | RF-003 | P1 | Aprobada |
| `SPEC-107` | Revocar sesiones al cambiar contraseña | — | — | — | — | ⤵ Absorbida por SPEC-103 |

## 2xx: Archivos, Papelera y Versiones

| ID | Especificación | Nivel | Responsable | Requisitos | Prioridad | Estado |
|---|---|:---:|---|---|:---:|:---:|
| `SPEC-201` | Tamaño y fecha de carpetas en el explorador | N0 | Víctor | RF-007 | — | ✅ Hecho (sin commit) |
| `SPEC-202` | `GET /files/trash` (solo archivos, Drive propio) | N1 | Miguel | RF-009 | **P2** | En revisión |
| `SPEC-203` | `POST /files/:id/restore` | N2 | Miguel | RF-009 | **P2** | En revisión |
| `SPEC-204` | `DELETE /files/:id/purge` | N2 | Miguel | RF-009, RF-013 | **P2** | En revisión |
| `SPEC-205` | Frontend: papelera y "Mover a papelera" | N1 | Miguel | RF-009 | **P2** | En revisión |
| `SPEC-206` | `GET /files/:id/versions` (solo lectura) | N1 | Miguel | RF-008 (parcial) | **P2** | En revisión |
| `SPEC-207` | Frontend: modal de versiones | N1 | Miguel | RF-008 (parcial) | **P2** | En revisión |
| `SPEC-208` | Descarga de carpeta en ZIP | N2 | Miguel | Usabilidad | 100% | Pendiente |
| `SPEC-209` | Enlaces compartidos temporales | N2 | Miguel | RF-010, RF-011 | 100% | Pendiente |

## 3xx: Facturación

| ID | Especificación | Nivel | Responsable | Requisitos | Prioridad | Estado |
|---|---|:---:|---|---|:---:|:---:|
| `SPEC-301` | Registro y consulta de operaciones de facturación | N2 | Anthony | RF-013, Curso §4.2 | P1 | Aprobada |
| `SPEC-302` | Renovación `POST /subscriptions/renew` (antes "cambio de plan") | N2 | Anthony | RF-013, Curso §4.2 | P1 | En revisión |
| `SPEC-303` | Frontend: historial y "Renovar" en `/suscripcion` | N1 | Miguel (delegado) | RF-013, Curso §4.2 | P1 | En revisión |
| `SPEC-304` | Bloqueo de reducción de plan por espacio ocupado | — | — | RF-013 | — | ✅ Cubierta por `SubscriptionCoordinator` (`STORAGE_QUOTA_EXCEEDED`) |

## 4xx: Auditoría

| ID | Especificación | Nivel | Responsable | Requisitos | Prioridad | Estado |
|---|---|:---:|---|---|:---:|:---:|
| `SPEC-401` | Servicio base de auditoría (`AuditModule` global, hash desde la v1) | N2 | Anthony | RF-012, RNF-007 | P1 | En revisión |
| `SPEC-402` | `GET /audit/events` (solo `tenant_admin`) | N1 | Miguel (delegado) | RF-012 | P1 | En revisión |
| `SPEC-403` | Frontend: pantalla de auditoría | N1 | Víctor | RF-012 | P1 | En revisión |
| `SPEC-404` | Verificación de la cadena de hashes y checkpoints | N2 | Anthony | RNF-007 | 100% | Pendiente |
| `SPEC-405` | Enganches de auditoría por dueño de módulo (**nueva**) | N1 | Víctor (IAM) / Miguel (Files) / Anthony (Billing) | RF-012, RNF-007 | P1 | En revisión |

## 5xx: Super Admin

| ID | Especificación | Nivel | Responsable | Requisitos | Prioridad | Estado |
|---|---|:---:|---|---|:---:|:---:|
| `SPEC-501` | Endpoints administrativos de plataforma | N2 | Sebastián | RF-016 | 100% | Pendiente |
| `SPEC-502` | Pantalla Super Admin con datos reales | N1 | Víctor | RF-016 | 100% | Pendiente |

> Hasta SPEC-502, `/dashboard/super-admin` es una maqueta con cifras inventadas: **ocultarla del menú** o marcarla visiblemente.

## 6xx: Frontend común

| ID | Especificación | Nivel | Responsable | Requisitos | Prioridad | Estado |
|---|---|:---:|---|---|:---:|:---:|
| `SPEC-601` | Perfil con datos reales de la sesión (sin edición) | N1 | Víctor | RF-001 | **P2** | En revisión |
| `SPEC-602` | Notificaciones tipo toast y estados de carga | N0 | Víctor | RNF-009 | 100% | Pendiente |
| `SPEC-603` | Contraste y accesibilidad WCAG AA | N1 | Víctor | RNF-008, RNF-009 | 100% | Pendiente |

## 7xx: Entregables académicos

| ID | Entregable | Formato | Responsable | Prioridad | Estado |
|---|---|---|---|:---:|:---:|
| `SPEC-701` | Documento de requisitos con casos de uso (`docs/entregables/REQUISITOS_CASOS_USO.md`) | Markdown / PDF | Víctor | P1 | **Borrador asistido listo**; falta revisión de Víctor |
| `SPEC-702` | Paquete de diagramas UML (`docs/entregables/DIAGRAMAS_UML.md`, 13 diagramas validados con el parser de Mermaid) | Mermaid | Víctor (con apoyo de Miguel y Sebastián) | P1 | **Borrador asistido listo**; falta revisión de Víctor |
| `SPEC-703` | Manual técnico | Markdown / PDF | Víctor | 100% | Pendiente |
| `SPEC-704` | Manual de usuario | Markdown / PDF | Víctor | 100% | Pendiente |
| `SPEC-705` | Matriz de trazabilidad y pruebas | Markdown | Equipo | 100% | Pendiente |

---

## Resumen

| Concepto | Cantidad |
|---|:---:|
| P1 (80%, imprescindible) | 15 |
| P2 (80%, si hay tiempo) | 7 |
| 100% (primera semana de noviembre) | 11 |
| Hechas / cubiertas / absorbidas | 5 (001, 002, 201, 304, 107) |
| **Total** | **37 + 405 = 38** |

> P2: 202, 203, 204, 205, 206, 207, 601. Las 11 del 100%: 003, 208, 209, 404, 501, 502, 602, 603, 703, 704, 705.

---|:---:|
| P1 (80%, imprescindible) | 19 |
| P2 (80%, si hay tiempo) | 4 |
| 100% (primera semana de noviembre) | 11 |
| Hechas / cubiertas / absorbidas | 4 (001, 201, 304, 107) |
| **Total** | **37 + 405 = 38** |

> P1 incluye SPEC-002 (corrección pendiente del ADR-006). Las 11 del 100% son 003, 208, 209, 404, 501, 502, 602, 603, 703, 704 y 705.

---

## Reglas de lectura

- Un requisito citado en una spec debe existir con ese número en la propuesta (§9). Si no, se cita el curso.
- Ninguna spec decora endpoints de otro módulo: cada dueño aplica `@Roles` y los eventos de auditoría en su propia spec (matriz: ADR-007 §4; eventos: SPEC-405).
