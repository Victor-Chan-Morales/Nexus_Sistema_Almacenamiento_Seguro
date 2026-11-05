# SPEC-404: VERIFICAR LA CADENA DE AUDITORÍA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (auditoría) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/audit/`, `apps/web/src/components/audit-log.tsx` |
| **Requisitos Vinculados** | RNF-007, RF-012 |
| **Dependencias** | SPEC-407 |
| **Prioridad** | P1 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Comprobar que nadie alteró el historial. Cada evento guarda un hash encadenado al anterior; hasta hoy nadie lo verifica.

## 3. Fuera de Alcance

- Checkpoints firmados (`audit.audit_chain_checkpoint`). Por eso, **borrar los eventos finales de la cadena no se detecta** (ADR-008 §10).
- Verificación programada o alertas.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Cadena íntegra
  Dada una organización con eventos sin alterar
  Cuando un tenant_admin envía GET /audit/verify
  Entonces responde 200 con valid: true y checkedEvents

Escenario 2: Evento alterado
  Dado un evento modificado (por ejemplo, su action_type)
  Entonces responde valid: false, firstBrokenEventId con ese evento y reason: HASH_MISMATCH

Escenario 3: Enlace roto
  Dado un prev_hash que no coincide con el evento anterior
  Entonces reason: PREV_HASH_MISMATCH

Escenario 4: Evento borrado en medio
  Dado un salto en chain_seq
  Entonces reason: SEQUENCE_GAP

Escenario 5: Cadena vacía
  Dada una organización sin eventos → valid: true y checkedEvents: 0

Escenario 6: Aislamiento
  Entonces solo verifica la organización de la sesión

Escenario 7: Permisos
  Dado un colaborador → 403 FORBIDDEN_ROLE

Escenario 8: Pantalla
  Dado /auditoria
  Cuando pulsa "Verificar integridad"
  Entonces muestra el resultado, y si falla, el evento afectado

Escenario 9: Volumen
  Dados 10 000 eventos
  Entonces los recorre por lotes sin cargarlos todos en memoria
```

## 5. Contrato de API

`GET /audit/verify` (`tenant_admin`):

```json
{ "valid": false, "checkedEvents": 120, "firstBrokenEventId": "uuid", "reason": "HASH_MISMATCH", "verifiedAt": "ISO-8601" }
```

`firstBrokenEventId` y `reason` son `null` si es válida. Los fallos de integridad responden `200`: la consulta fue exitosa.

## 6. Datos y Esquema

Sin migración. Usa `chain_seq`, `prev_hash` y `record_hash`.

## 7. Interfaz de Usuario

Botón en `audit-log.tsx`, con estados de proceso, éxito y alerta, más el error de red.

## 8. Diseño Técnico

```typescript
// AuditService
verifyChain(organizationId: string): Promise<AuditVerificationDto>;
```

- Lotes de 500 ordenados por `chain_seq`, paginando con `chain_seq > :last`.
- Por evento: `computeRecordHash` con los campos guardados, igual a `record_hash`; `prevHash` igual al anterior; secuencia consecutiva desde 1. Se detiene en el primer fallo.
- **Comparación de `occurred_at`:** `computeRecordHash` usa `toISOString()` (milisegundos). Comprobar que el valor leído de la BD no pierde ni agrega precisión.
- **Eventos previos a `chain_seq`:** la migración `20261029090000` los numeró **sin recalcular `record_hash`**. Como `computeRecordHash` incluye `chainSeq`, un evento escrito antes de esa migración podría verificarse como alterado. Comprobarlo primero con datos reales de una base migrada. Si ocurre, se reinicia esa base de desarrollo (ver §12); no se agrega código para aceptar esos eventos.
- **Probar manipulación:** `audit.audit_event` bloquea `UPDATE` por trigger. En pruebas con Postgres, deshabilitarlo con el rol de migraciones, solo en una base desechable.

## 9. Plan de Tareas

- [ ] **T1 (45 min)**: `verifyChain` y DTO.
- [ ] **T2 (15 min)**: Ruta `GET /audit/verify`.
- [ ] **T3 (25 min)**: Botón y resultado.
- [ ] **T4 (35 min)**: Pruebas.

**Archivos permitidos:** `audit/audit.service.ts`, `audit/audit.controller.ts`, `audit/dto/verify-audit.dto.ts` (nuevo), sus `*.spec.ts`, `components/audit-log.tsx`, `lib/api/audit.ts`, `lib/api/types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–7, 9 | Unitaria | `audit.service.spec.ts`, `audit.controller.spec.ts` |
| Escenario 2 real y datos migrados | Manual con Postgres | Evidencia en el PR |
| Escenario 8 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6, `docs/modules/AUDIT.md`.

## 12. Preguntas Abiertas

Ninguna. Decisión del coordinador (2026-11-04): si la verificación marca eventos anteriores a `chain_seq`, se reinician las bases de desarrollo, porque no hay datos productivos. El PR y `docs/modules/AUDIT.md` lo dejan indicado.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada, con decisión de §12. |
