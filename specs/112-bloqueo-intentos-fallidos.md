# SPEC-112: BLOQUEO PROGRESIVO POR INTENTOS FALLIDOS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (autenticación y migración) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/`, `database/migrations/` |
| **Requisitos Vinculados** | Riesgos §16 (fuerza bruta) |
| **Dependencias** | SPEC-004 |
| **Prioridad** | P1 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Frenar a quien intenta adivinar contraseñas: tras varios errores, la cuenta espera cada vez más antes de aceptar otro intento. `failed_login_attempts` existe, pero el login no lo usa.

## 3. Fuera de Alcance

- Límite por dirección IP y CAPTCHA.
- Avisar por correo del bloqueo.
- Pantalla para desbloquear cuentas.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Contador
  Dada una cuenta activa
  Cuando falla la contraseña
  Entonces failed_login_attempts aumenta en 1 y responde 401 INVALID_CREDENTIALS

Escenario 2: Bloqueo
  Dados 5 intentos fallidos seguidos
  Entonces locked_until = ahora + 1 minuto
  Y cada fallo posterior, ya pasado el bloqueo, duplica la espera hasta un máximo de 30 minutos

Escenario 3: Contraseña correcta durante el bloqueo
  Dada una cuenta con locked_until en el futuro
  Cuando envía la contraseña correcta
  Entonces responde 401 INVALID_CREDENTIALS y no abre sesión
  Y no aumenta el contador

Escenario 4: Sin enumeración
  Entonces una cuenta bloqueada, una contraseña incorrecta y un correo inexistente
  responden el mismo código y mensaje, con hash Argon2 verificado en los tres casos

Escenario 5: Éxito
  Cuando inicia sesión correctamente sin bloqueo
  Entonces el contador vuelve a 0 y locked_until a NULL

Escenario 6: Recuperar contraseña
  Cuando restablece la contraseña
  Entonces el contador vuelve a 0 y locked_until a NULL

Escenario 7: Concurrencia
  Dados 10 intentos fallidos simultáneos
  Entonces el contador aumenta exactamente 10
```

## 5. Contrato de API

`POST /auth/login` no cambia de forma. Se mantiene `401 INVALID_CREDENTIALS`.

## 6. Datos y Esquema

```sql
-- migrate:up
ALTER TABLE iam."user" ADD COLUMN locked_until timestamptz;
COMMENT ON COLUMN iam."user".locked_until IS 'Bloqueo temporal por intentos fallidos';
-- migrate:down
ALTER TABLE iam."user" DROP COLUMN locked_until;
```

No se usa `status = locked`, que queda para bloqueos administrativos permanentes.

## 8. Diseño Técnico

```typescript
// UserRepository
abstract registerFailedLogin(userId: string, now: Date): Promise<void>; // incremento atómico en SQL
abstract clearFailedLogins(userId: string, tx?: TransactionContext): Promise<void>;
```

- **Fórmula:** `intentos < 5` → sin bloqueo; `intentos >= 5` → `min(60 s × 2^(intentos − 5), 30 min)`.
- **Orden en `authenticate`:** verificar la contraseña siempre → si `lockedUntil > now` → `invalidCredentials`. Si es incorrecta → `registerFailedLogin`. Si es correcta → sigue el flujo actual y limpia el contador tras abrir sesión.
- El registro del fallo va fuera de cualquier transacción que se revierta al lanzar el error.
- **Riesgo aceptado:** alguien puede bloquear temporalmente a otra persona si conoce su correo. El máximo de 30 minutos lo acota.

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: Migración, entidad y repositorio.
- [ ] **T2 (50 min)**: Lógica en `auth.service.ts` y `password-reset.service.ts`.
- [ ] **T3 (50 min)**: Pruebas.

**Archivos permitidos:** la migración, `entities/user.entity.ts`, `ports/repositories.ts`, `infrastructure/typeorm-repositories.ts`, `services/auth.service.ts`, `services/password-reset.service.ts`, `iam.security.spec.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–6 | Unitaria | `iam.security.spec.ts` |
| Escenario 7 | E2E con Postgres | `apps/api/test/iam.e2e-spec.ts` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6: comportamiento de bloqueo.
- [ ] `docs/modules/IAM.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
