# PLANTILLA DE ESPECIFICACIÓN SDD-LITE — NEXUS

> Esta plantilla es utilizada por los integrantes del equipo o por el subagente `planificador` para redactar especificaciones en `specs/<ID>-<nombre>.md`.

---

```markdown
# SPEC-<ID>: <TÍTULO DE LA ESPECIFICACIÓN>

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N0 (Receta) / N1 (Ligera) / N2 (Completa / Zona Protegida) |
| **Responsable Principal** | Sebastián (IAM) / Miguel (Files) / Anthony (Billing) / Víctor (Frontend/Integración) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/<modulo>` y/o `apps/web/src/app/<ruta>` |
| **Requisitos Vinculados** | RF-00X, RNF-00Y |
| **Dependencias** | Ninguna / SPEC-XXX |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) / Corte 100% (Nov-2026) |
| **Estado** | Borrador / En Revisión / Aprobada / En Progreso / Hecho |

---

## 2. Objetivo

*Descripción concisa de 2 a 3 líneas explicando el problema que resuelve y el valor que aporta al sistema Nexus.*

---

## 3. Fuera de Alcance (YAGNI)

*Lista explícita de lo que NO se construirá en esta especificación para evitar sobre-ingeniería.*
- No se construirá X.
- No se soportará Y en esta iteración.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: [Nombre descriptivo del caso exitoso]
  Dado que el usuario autenticado tiene el rol "tenant_admin"
  Cuando envía una solicitud POST a "/api/..." con los datos requeridos
  Entonces el sistema responde con código HTTP 201 Created
  Y la base de datos registra la entidad con el "organization_id" del token

Escenario 2: [Caso de error o violación de regla de negocio]
  Dado que el usuario autenticado no posee permisos suficientes
  Cuando intenta invocar la operación
  Entonces el sistema responde con código HTTP 403 Forbidden
  Y no se realiza ningún cambio en el estado del sistema
```

---

## 5. Contrato de API

### Endpoint: `<MÉTODO> /api/<ruta>`

- **Autenticación requerida:** Sí (Bearer JWT) / Pública
- **Rol requerido:** `tenant_admin` / `collaborator` / ninguno

#### Parámetros de Entrada / Payload (DTO)
```json
{
  "campoObligatorio": "string",
  "campoOpcional": 123
}
```

#### Respuesta Exitosa (`200 OK` o `201 Created`)
```json
{
  "id": "uuid-generado",
  "status": "success",
  "createdAt": "2026-10-30T12:00:00Z"
}
```

#### Errores Canónicos
| Código HTTP | Error Code | Causa |
|---|---|---|
| `400 Bad Request` | `VALIDATION_FAILED` | Parámetros inválidos o faltantes. |
| `401 Unauthorized` | `INVALID_TOKEN` | Token JWT ausente o expirado. |
| `403 Forbidden` | `FORBIDDEN_RESOURCE` | Rol insuficiente para ejecutar la acción. |
| `404 Not Found` | `RESOURCE_NOT_FOUND` | Recurso inexistente o perteneciente a otra organización. |
| `422 Unprocessable` | `BUSINESS_RULE_VIOLATION` | Violación de cuota o límite. |

---

## 6. Datos y Esquema

- **¿Modifica el esquema de base de datos?**: Sí / No
- **Tablas afectadas**: `nombre_tabla`
- *Si modifica esquema (N2), detallar la migración SQL necesaria en `database/migrations/`.*

---

## 7. Interfaz de Usuario (UI/UX)

- **Ruta de la pantalla:** `apps/web/src/app/<ruta>`
- **Estados de Interfaz Obligatorios:**
  - **Loading:** Skeleton o loader con tokens de `docs/IDENTIDAD_VISUAL.md`.
  - **Empty:** Mensaje cuando no hay registros.
  - **Error:** Feedback claro con botón de reintento.
  - **Data:** Renderizado con componentes comunes.

---

## 8. Diseño Técnico (Obligatorio para N2)

- **Firmas de métodos clave:**
```typescript
async ejecutarOperacion(orgId: string, dto: OperacionDto): Promise<ResultadoDto>;
```
- **Transaccionalidad:** Detallar si requiere `QueryRunner` o transacción TypeORM.
- **Auditoría:** Evento a registrar en bitácora de auditoría.
- **Riesgos y mitigaciones:** Identificación de posibles puntos de falla.

---

## 9. Plan de Tareas (≤ 2 horas cada una)

- [ ] **Tarea 1 (Backend - DTO y Puerto)**: Crear DTOs de entrada y validaciones con class-validator (1h). *Archivos:* `...`
- [ ] **Tarea 2 (Backend - Servicio y Lógica)**: Implementar lógica de negocio y validación de cuota/rol (2h). *Archivos:* `...`
- [ ] **Tarea 3 (Backend - Pruebas)**: Escribir pruebas unitarias en `*.spec.ts` para cubrir ACs (1.5h). *Archivos:* `...`
- [ ] **Tarea 4 (Frontend - Cliente API y Vista)**: Conectar pantalla React con el endpoint y manejar estados (2h). *Archivos:* `...`

---

## 10. Estrategia de Pruebas

| Criterio de Aceptación | Tipo de Prueba | Archivo de Prueba |
|---|---|---|
| Escenario 1 (Éxito) | Unitaria / Integración | `apps/api/src/modules/.../*.spec.ts` |
| Escenario 2 (Permisos 403) | Unitaria | `apps/api/src/modules/.../*.spec.ts` |
| Aislamiento Multitenant (404 a otra org) | Integración | `apps/api/src/modules/.../*.spec.ts` |

---

## 11. Impacto en Documentación

- [ ] Actualizar `CONTRACTS.md`
- [ ] Actualizar `ENTS_REGISTRY.md`
- [ ] Actualizar matriz de trazabilidad de requisitos en `docs/entregables/README.md`

---

## 12. Preguntas Abiertas

*Puntos no definidos que requieren confirmación de Víctor Chán antes o durante el desarrollo.*
- 1. ...

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción del Cambio |
|---|---|---|
| 2026-10-XX | Nombre | Versión inicial de la especificación. |
```
