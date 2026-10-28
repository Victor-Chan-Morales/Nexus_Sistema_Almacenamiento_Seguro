# SPEC-405: ENGANCHES DE AUDITORÍA POR DUEÑO DE MÓDULO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (una llamada por evento; el servicio es de SPEC-401) |
| **Responsable Principal** | Víctor (IAM, para descargar la ruta crítica de Sebastián), Miguel (Files), Anthony (Billing) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `modules/iam/`, `modules/files/`, `modules/integration/` |
| **Requisitos Vinculados** | RF-012, RNF-007 |
| **Dependencias** | SPEC-401 (`AuditService`, global). Los eventos de 102, 103, 203, 204, 302 se añaden aquí, no en esas specs. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | Víctor 0.5 h · Miguel 0.5 h · Anthony 0.3 h |
| **Estado** | En revisión (spec nueva, 2026-10-27) |

---

## 2. Objetivo

SPEC-401 entrega el servicio, pero la auditoría no sirve hasta que las operaciones lo llamen. Anthony no puede editar IAM ni Files (zonas de otros dueños, IAM protegida), así que cada dueño añade las llamadas de **su** módulo, con una sola línea por evento.

---

## 3. Fuera de Alcance (YAGNI)

- Eventos fallidos (login incorrecto, 403, 404), lecturas de listados y eventos de `visitor`/`system`.
- Cualquier dato adicional al evento (nombres de archivo, IP).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Cada acción deja su evento
  Dado una operación exitosa de la tabla siguiente
  Entonces existe un evento con ese action_type, organización y actor del token, y el resourceId indicado

Escenario 2: Solo si la operación tuvo éxito
  Dado que la operación falla (4xx/5xx o transacción revertida)
  Entonces no se registra evento

Escenario 3: Nunca afecta a la operación
  Dado que logEvent falla
  Entonces la operación principal responde igual que sin auditoría

Escenario 4: Después del commit
  Entonces la llamada ocurre cuando la transacción de la operación ya se confirmó (nunca dentro de ella)
```

---

## 5. Contrato de API

No cambia ninguna respuesta HTTP. Eventos (nombres de `CONTRACTS.md` v0.5):

| `action` | Dónde | `resourceType` / `resourceId` | Dueño |
|---|---|---|---|
| `AUTH_LOGIN` | `AuthService.authenticate`, tras abrir la sesión | `user` / id del usuario | Víctor |
| `AUTH_PASSWORD_RESET` | `PasswordResetService.reset`, tras el commit | `user` / id del usuario | Víctor |
| `MEMBER_ADDED` | `MembersService.addMember`, tras el commit | `membership` / id de la membresía | Víctor |
| `FILE_UPLOAD` | `uploadMultipartFile`, tras confirmar (archivo nuevo o nueva versión) | `file` / id del archivo | Miguel |
| `FILE_DOWNLOAD` | `FilesController.downloadFile`, tras obtener el archivo | `file` / id del archivo | Miguel |
| `FILE_DELETE` | `softDelete`, tras guardar | `file` / id del archivo | Miguel |
| `FILE_RESTORE` | `restoreFile`, tras el commit | `file` / id del archivo | Miguel |
| `FILE_PURGE` | `purgeFile`, tras el commit | `file` / id del archivo | Miguel |
| `PLAN_ACTIVATED` | `SubscriptionsController.activate`, tras responder con éxito (también en la reactivación idempotente) | `subscription` / `subscriptionId` | Anthony |
| `PLAN_RENEWED` | `SubscriptionsController.renew`, tras el éxito | `subscription` / `subscriptionId` | Anthony |

---

## 6. Datos y Esquema

No modifica BD.

---

## 7. Interfaz de Usuario

No aplica.

---

## 8. Diseño Técnico

- Patrón único: `void this.audit.logEvent({ organizationId, actorId, action, resourceType, resourceId });` (sin `await` cuando no se necesita el resultado; `logEvent` nunca lanza). Los datos salen de `req.user`/del resultado de la operación, nunca del cuerpo de la petición.
- No añadir campos ni texto libre al evento: el tipo `AuditEventInput` no los admite.

---

## 9. Plan de Tareas

- [ ] **T1 (Víctor, 30 min; después de que se mergeen 103 y 102)**: `AUTH_LOGIN`, `AUTH_PASSWORD_RESET`, `MEMBER_ADDED` + una prueba por evento que verifique la llamada con los argumentos correctos.
- [ ] **T2 (Miguel, 30 min)**: los cinco `FILE_*` + pruebas.
- [ ] **T3 (Anthony, 20 min)**: `PLAN_ACTIVATED`, `PLAN_RENEWED` + pruebas.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–4 (por dueño) | Unitaria con `AuditService` simulado | specs del servicio o controlador de cada módulo |
| Recorrido completo | Manual | Verificar en `/auditoria` que aparece cada acción |

---

## 11. Impacto en Documentación

Ninguno (los eventos están en `CONTRACTS.md` v0.5).

---

## 12. Preguntas Abiertas

Ninguna. Decisión: ADR-007 §8.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Revisión | Spec nueva: separa los enganches de la creación del servicio para respetar la propiedad por directorio (la spec 401 original pedía a Anthony editar `AuthService` y `FilesService`). |
