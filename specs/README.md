# BACKLOG GENERAL DE ESPECIFICACIONES — NEXUS

> **Sistema de Almacenamiento Seguro Híbrido (PaaS/STaaS)**
>
> - **Decisiones vigentes:** `docs/decisions/ADR-008-alcance-final.md`, junto con ADR-002, ADR-003, ADR-006 y ADR-007.
> - **Contratos:** `CONTRACTS.md`. Cada spec nueva agrega sus rutas a la sección **v0.6** antes de programar.
> - **Numeración de requisitos:** la de la propuesta (RF-001…RF-016, RNF-001…RNF-011). Lo que exige el curso y la propuesta no numera se cita como "Curso §4.1/§4.2".
> - **Estado:** el coordinador aprobó las specs pendientes el 2026-11-04. Aún no tienen responsable asignado, salvo las que ya lo indicaban.

---

## Prioridades del alcance final

| Prioridad | Significado | Specs | Horas estimadas |
|---|---|:---:|:---:|
| **P1** | Esencial: completa la propuesta y las decisiones del coordinador | 32 | ~74 |
| **P2** | Solo si sobra tiempo | 13 | ~21.5 |
| **P3** | Opcional | 2 | ~4 |
| **Total** | | **47** | **~99.5** |

Las horas son estimaciones aproximadas de implementación, sin contar revisión.

**Orden de recorte si hiciera falta:** P3 → P2 → SPEC-005 y SPEC-404.

## Orden de ejecución

Una flecha indica que la spec siguiente espera a que se fusione la anterior. Dentro de una misma etapa, cada línea puede avanzar en paralelo.

1. **Etapa 1, secuencial:** 004 → 006 → 221 → 801. **Nadie más toca los módulos `files` ni `storage` del backend hasta que se fusionen 221 y 801.**
2. **Etapa 2, en paralelo:**
   - Versiones: 206 → 207 → 210.
   - Enlaces: 209 (tras 206).
   - Equipos: 220.
   - Destinos: 802 → 803 → 804.
   - Instalación: 805 → 806.
3. **Etapa 3:**
   - Enlaces: 216 (tras 209, 210 y 407) → 217.
   - Papelera: 215 (tras 407).
   - Equipos: 222 (tras 220, 209 y 210) → 224 → 223.
   - Rotación de llaves: 005 (tras 802).
4. **Etapa 4:** Super Admin: 503 (tras 501 y 803) → 502.
5. **Etapa 5, P2:** 113 (tras 601) · 115 (tras 108 y 114) · 211 → 212 (tras 224) · 213 · 306 · 406 · 504 · 606.
6. **Etapa 6, P3:** 208 (requiere aprobar antes un ADR para su librería) · 603 (al final).

**Autónomas (no esperan a otra área):**
- **Desde el inicio:** 214, 307, 601, 602 y 605.
- **Tras 004:** 112, 305, 501, 407 y 108. Después: 108 → 109 y 114; 407 → 404.

Todas siguen el flujo normal de aprobación y fusión.

**No ejecutar al mismo tiempo, porque editan las mismas partes de `files.service.ts`:** 215, 222, 224, 803 y 005.

**Puntos de coordinación:**
- 005 y 802 comparten el formato de `connection_details_encrypted`.
- 503 y 803 comparten la entidad de `admin.installation_request`.
- 108, 112, 114 y 503 editan los repositorios de IAM: fusionar una y actualizar las demás.
- 214, 207, 217, 212, 213, 223 y 804 editan `file-browser-live.tsx`.

---

## 0xx: Fundación, Infraestructura y Criptografía

| ID | Especificación | Nivel | Requisitos | Prioridad | Dependencias | Estado |
|---|---|:---:|---|:---:|---|:---:|
| `SPEC-001` | Corrección del cálculo recursivo de carpetas y bytes | N0 | RF-007, RF-013 | — | — | ✅ Hecho |
| `SPEC-002` | ADR-006: cifrado `node:crypto` AES-256-GCM | N1 | RF-004, RF-005, RNF-003 | — | — | ✅ Hecho |
| `SPEC-003` | Integración continua (GitHub Actions) | N1 | Calidad | — | — | ✅ Hecho |
| `SPEC-004` | [Alinear los documentos con el alcance final](004-alinear-alcance-final.md) | N1 | Gobernanza | P1 | — | Aprobada |
| `SPEC-005` | [Rotación de llaves](005-rotacion-llaves.md) | N2 | RF-005 | P1 | 006 | Aprobada |
| `SPEC-006` | [Pruebas del cifrado](006-pruebas-cifrado.md) | N1 | RF-004, RF-005, RNF-003 | P1 | 004 | Aprobada |

## 1xx: IAM, Roles y Miembros

| ID | Especificación | Nivel | Requisitos | Prioridad | Dependencias | Estado |
|---|---|:---:|---|:---:|---|:---:|
| `SPEC-101` | `@Roles` y `RolesGuard` | N2 | RF-003 | — | — | ✅ Hecho |
| `SPEC-102` | Alta de miembros | N2 | RF-003, Curso §4.1 | — | — | ✅ Hecho |
| `SPEC-103` | Recuperación de contraseña | N2 | Curso §4.1, RNF-004 | — | — | ✅ Hecho |
| `SPEC-104` | Listado de miembros | N2 | RF-003 | — | — | ✅ Hecho |
| `SPEC-105` | Frontend: recuperar contraseña | N1 | Curso §4.1 | — | — | ✅ Hecho |
| `SPEC-106` | Frontend: miembros en `/configuracion` | N1 | RF-003 | — | — | ✅ Hecho |
| `SPEC-107` | Revocar sesiones al cambiar contraseña | — | — | — | — | ⤵ Absorbida por SPEC-103 |
| `SPEC-108` | [Administrar miembros: backend](108-administrar-miembros.md) | N2 | RF-003 | P1 | 004 | Aprobada |
| `SPEC-109` | [Administrar miembros: pantalla](109-frontend-administrar-miembros.md) | N1 | RF-003 | P1 | 108 | Aprobada |
| `SPEC-112` | [Bloqueo progresivo por intentos fallidos](112-bloqueo-intentos-fallidos.md) | N2 | Riesgos §16 | P1 | 004 | Aprobada |
| `SPEC-113` | [Editar perfil y cambiar contraseña](113-perfil-cambiar-contrasena.md) | N2 | RF-001, Curso §4.1 | P2 | 601 | Aprobada |
| `SPEC-114` | [Eliminar empresa (bloquear y conservar)](114-eliminar-empresa.md) | N2 | Administración §8 | P1 | 108 | Aprobada |
| `SPEC-115` | [Correos informativos en Mailpit](115-correos-mailpit.md) | N2 | Curso §4.1 | P2 | 108, 114 | Aprobada |

## 2xx: Archivos, Versiones, Enlaces y Equipos

| ID | Especificación | Nivel | Requisitos | Prioridad | Dependencias | Estado |
|---|---|:---:|---|:---:|---|:---:|
| `SPEC-201` | Tamaño y fecha de carpetas en el explorador | N0 | RF-007 | — | — | ✅ Hecho |
| `SPEC-202` | Listar papelera | N1 | RF-009 | — | — | ✅ Hecho |
| `SPEC-203` | Restaurar de la papelera | N2 | RF-009 | — | — | ✅ Hecho |
| `SPEC-204` | Purga definitiva | N2 | RF-009, RF-013 | — | — | ✅ Hecho |
| `SPEC-205` | Frontend: papelera | N1 | RF-009 | — | — | ✅ Hecho |
| `SPEC-206` | [Listar versiones](206-historial-versiones.md) | N1 | RF-008 | P1 | 221 | Aprobada |
| `SPEC-207` | [Modal de versiones](207-frontend-historial-versiones.md) | N1 | RF-008 | P1 | 206 | Aprobada |
| `SPEC-208` | [Descargar carpeta en ZIP](208-descargar-carpeta-zip.md) | N2 | Usabilidad | P3 | 221 | Aprobada |
| `SPEC-209` | [Crear, listar y revocar enlaces](209-enlaces-compartidos.md) | N2 | RF-010, RF-011 | P1 | 206 | Aprobada |
| `SPEC-210` | [Descargar y restaurar una versión](210-descargar-restaurar-version.md) | N2 | RF-008 | P1 | 206, 207 | Aprobada |
| `SPEC-211` | [Renombrar y mover: backend](211-renombrar-mover.md) | N2 | RF-007 | P2 | 221 | Aprobada |
| `SPEC-212` | [Renombrar y mover: pantalla](212-frontend-renombrar-mover.md) | N1 | RF-007 | P2 | 211 | Aprobada |
| `SPEC-213` | [Búsqueda global por nombre](213-busqueda-global.md) | N1 | RF-007 | P2 | 221 | Aprobada |
| `SPEC-214` | [Arrastrar y soltar e íconos por tipo](214-arrastrar-iconos.md) | N1 | UI/UX §8 | P1 | — | Aprobada |
| `SPEC-215` | [Purga automática a los 30 días](215-purga-automatica.md) | N2 | RF-009, RF-013 | P1 | 004, 407 | Aprobada |
| `SPEC-216` | [Acceso público al enlace](216-acceso-publico-enlace.md) | N2 | RF-010, RF-011, RF-012 | P1 | 209, 210, 407 | Aprobada |
| `SPEC-217` | [Pantallas de compartir](217-frontend-compartir.md) | N1 | RF-010, RF-011 | P1 | 209, 216 | Aprobada |
| `SPEC-220` | [Equipos y sus miembros](220-equipos-miembros.md) | N2 | RF-006, RF-003 | P1 | 221 | Aprobada |
| `SPEC-221` | [Centralizar el acceso a Drives](221-acceso-drive.md) | N2 | RF-006, RF-007, RF-003 | P1 | 006 | Aprobada |
| `SPEC-222` | [Drive de equipo: lectura](222-drive-equipo-lectura.md) | N2 | RF-006 | P1 | 220, 209, 210 | Aprobada |
| `SPEC-223` | [Pantallas de equipos](223-frontend-equipos.md) | N1 | RF-006 | P1 | 224 | Aprobada |
| `SPEC-224` | [Drive de equipo: edición](224-drive-equipo-edicion.md) | N2 | RF-006, RF-009 | P1 | 222 | Aprobada |

## 3xx: Facturación

| ID | Especificación | Nivel | Requisitos | Prioridad | Dependencias | Estado |
|---|---|:---:|---|:---:|---|:---:|
| `SPEC-301` | Registro y consulta de operaciones | N2 | RF-013, Curso §4.2 | — | — | ✅ Hecho |
| `SPEC-302` | Renovación | N2 | RF-013, Curso §4.2 | — | — | ✅ Hecho |
| `SPEC-303` | Frontend: historial y "Renovar" | N1 | RF-013, Curso §4.2 | — | — | ✅ Hecho |
| `SPEC-304` | Bloqueo de reducción de plan por espacio ocupado | — | RF-013 | — | — | ✅ Cubierta |
| `SPEC-305` | [Pago simulado con tarjetas de prueba](305-pago-simulado-tarjetas.md) | N2 | RF-013, Curso §4.2 | P1 | 004 | Aprobada |
| `SPEC-306` | [Comprobantes descargables](306-comprobantes.md) | N1 | RF-013, Curso §4.2 | P2 | 305 | Aprobada |
| `SPEC-307` | [Comparativa de planes](307-comparativa-planes.md) | N1 | RF-013, Curso §4.2 | P2 | — | Aprobada |

## 4xx: Auditoría

| ID | Especificación | Nivel | Requisitos | Prioridad | Dependencias | Estado |
|---|---|:---:|---|:---:|---|:---:|
| `SPEC-401` | Servicio base de auditoría | N2 | RF-012, RNF-007 | — | — | ✅ Hecho |
| `SPEC-402` | `GET /audit/events` | N1 | RF-012 | — | — | ✅ Hecho |
| `SPEC-403` | Frontend: pantalla de auditoría | N1 | RF-012 | — | — | ✅ Hecho |
| `SPEC-404` | [Verificar la cadena de auditoría](404-verificar-cadena-auditoria.md) | N2 | RNF-007, RF-012 | P1 | 407 | Aprobada |
| `SPEC-405` | Enganches de auditoría | N1 | RF-012, RNF-007 | — | — | ✅ Hecho |
| `SPEC-406` | [Filtros y exportación](406-filtros-exportacion-auditoria.md) | N2 | RF-012 | P2 | 407 | Aprobada |
| `SPEC-407` | [Actores y resultados de auditoría](407-actores-auditoria.md) | N2 | RF-012, RNF-007 | P1 | 004 | Aprobada |

## 5xx: Super Admin

| ID | Especificación | Nivel | Requisitos | Prioridad | Dependencias | Estado |
|---|---|:---:|---|:---:|---|:---:|
| `SPEC-501` | [Identidad y consultas](501-super-admin-identidad.md) | N2 | RF-016 | P1 | 004 | Aprobada |
| `SPEC-502` | [Panel con datos reales](502-frontend-super-admin.md) | N1 | RF-016 | P1 | 501, 503 | Aprobada |
| `SPEC-503` | [Acciones de plataforma e instalaciones](503-acciones-plataforma.md) | N2 | RF-016, RF-015 | P1 | 501, 803 | Aprobada |
| `SPEC-504` | [Editar catálogo de planes](504-editar-planes.md) | N2 | RF-016 | P2 | 501, 502 | Aprobada |

> Hasta SPEC-502, `/dashboard/super-admin` es una maqueta con cifras inventadas que cualquier sesión puede abrir.

## 6xx: Frontend común

| ID | Especificación | Nivel | Requisitos | Prioridad | Dependencias | Estado |
|---|---|:---:|---|:---:|---|:---:|
| `SPEC-601` | [Perfil con datos reales](601-frontend-perfil-usuario.md) | N1 | RF-001 | P2 | — | Aprobada |
| `SPEC-602` | [Avisos y estados de carga](602-avisos-estados-carga.md) | N0 | RNF-009 | P2 | — | Aprobada |
| `SPEC-603` | [Accesibilidad](603-accesibilidad.md) | N1 | RNF-008, RNF-009 | P3 | — | Aprobada |
| `SPEC-605` | [Pulido de login y landing](605-pulido-login-landing.md) | N0 | RNF-009 | P2 | — | Aprobada |
| `SPEC-606` | [Retirar restos de demostración](606-retirar-demostracion.md) | N1 | Regla 11 | P2 | 502, 601, 307 | Aprobada |

## 8xx: Destinos y despliegue

| ID | Especificación | Nivel | Requisitos | Prioridad | Dependencias | Estado |
|---|---|:---:|---|:---:|---|:---:|
| `SPEC-801` | [Almacenamiento intercambiable (Strategy)](801-almacenamiento-strategy.md) | N2 | §12.1.1, RF-014 | P1 | 006, 221 | Aprobada |
| `SPEC-802` | [Administrar destinos](802-administrar-destinos.md) | N2 | RF-014, RF-015 | P1 | 801 | Aprobada |
| `SPEC-803` | [Elegir Nube, Local o Híbrido](803-elegir-modelo-despliegue.md) | N2 | RF-014, RF-015 | P1 | 802 | Aprobada |
| `SPEC-804` | [Pantalla de almacenamiento](804-frontend-almacenamiento.md) | N2 | RF-014 | P1 | 803 | Aprobada |
| `SPEC-805` | [Instalación on-premises en un comando](805-instalacion-on-premises.md) | N2 | RF-015, RNF-010 | P1 | 801 | Aprobada |
| `SPEC-806` | [HTTPS y cabeceras de seguridad](806-https-cabeceras.md) | N2 | RNF-002, RNF-011 | P1 | 805 | Aprobada |

---

## Fuera de este backlog

- **Excluido por decisión (ADR-008):** MFA/TOTP, modo oscuro, cifrado en streaming, Redis Streams, permisos por archivo individual, rol Auditor, instalación automática en el servidor del cliente y borrado físico al cerrar una empresa.
- **Trabajo no funcional, por planificar aparte:**

| ID | Entregable | Estado |
|---|---|:---:|
| `SPEC-701` | Documento de requisitos con casos de uso | Borrador |
| `SPEC-702` | Paquete de diagramas UML | Borrador |
| `SPEC-703` | Manual técnico | Pendiente |
| `SPEC-704` | Manual de usuario | Pendiente |
| `SPEC-705` | Matriz de trazabilidad y pruebas | Pendiente |

## Reglas de lectura

- Un requisito citado en una spec debe existir con ese número en la propuesta (§9). Si no, se cita el curso.
- Ninguna spec decora endpoints de otro módulo sin indicarlo en sus archivos permitidos.
- Cada spec define sus eventos de auditoría (ADR-007 §8).
