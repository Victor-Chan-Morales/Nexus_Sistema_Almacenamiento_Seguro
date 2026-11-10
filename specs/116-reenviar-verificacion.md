# SPEC-116: REENVIAR EL CORREO DE VERIFICACIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (Zona protegida: IAM, tokens y correo) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/`, `apps/web/src/app/verificar-correo/`, `apps/web/src/components/auth-forms.tsx`, `apps/web/src/lib/api/iam.ts` |
| **Requisitos Vinculados** | RF-001, Curso §4.1 |
| **Dependencias** | SPEC-004 (hecha) |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Hito Objetivo** | Corte 100% (Nov-2026) |
| **Estado** | Implementada |

---

## 2. Objetivo

Permitir que quien no recibió el correo de verificación pida un enlace nuevo desde la pantalla de verificación. Hoy, con `IAM_REQUIRE_VERIFIED_EMAIL=true`, una cuenta sin correo verificado no puede entrar, y no existe ninguna forma de corregirlo desde la aplicación.

---

## 3. Fuera de Alcance (YAGNI)

- No se reenvían invitaciones de miembro (SPEC-102 tampoco tiene reenvío).
- No se reenvía el correo de recuperación de contraseña, que ya tiene su propio flujo.
- No se cambia el correo de la cuenta.
- No se registra cada reenvío en la bitácora de auditoría.
- No hay límite por dirección IP: la API no tiene limitador de peticiones. El control es por cuenta.
- No se muestra al visitante si el correo existe o no.
- No se agrega un botón de reenvío en la pantalla de inicio de sesión.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Reenvío exitoso
  Dada una cuenta con correo sin verificar, activa, y sin reenvíos en los últimos 120 segundos
  Cuando alguien envía POST /api/auth/resend-verification con su correo
  Entonces el sistema responde 200 con el mensaje genérico
  Y se crea un token nuevo de verificación con vigencia de 15 minutos
  Y se encola un mensaje "email_verification" en iam.email_outbox
  Y los tokens de verificación anteriores sin usar quedan inválidos

Escenario 2: Correo que no existe
  Dado un correo sin cuenta registrada
  Cuando se envía POST /api/auth/resend-verification con ese correo
  Entonces el sistema responde 200 con exactamente el mismo cuerpo que en el Escenario 1
  Y no se crea ningún token ni ningún mensaje

Escenario 3: Cuenta ya verificada
  Dada una cuenta con correo ya verificado
  Cuando se envía POST /api/auth/resend-verification con su correo
  Entonces el sistema responde 200 con el mismo cuerpo del Escenario 1
  Y no se crea ningún token ni ningún mensaje

Escenario 4: Cuenta no activa
  Dada una cuenta con estado distinto de "active" (inactiva o bloqueada)
  Cuando se envía POST /api/auth/resend-verification con su correo
  Entonces el sistema responde 200 con el mismo cuerpo del Escenario 1
  Y no se crea ningún token ni ningún mensaje

Escenario 5: Enfriamiento de 120 segundos
  Dada una cuenta a la que se le emitió un token de verificación hace 30 segundos
  Cuando se envía POST /api/auth/resend-verification con su correo
  Entonces el sistema responde 200 con el mismo cuerpo del Escenario 1
  Y no se crea ningún token ni ningún mensaje
  Y el token emitido hace 30 segundos sigue siendo válido

Escenario 6: Tope diario de 5 tokens por cuenta
  Dada una cuenta a la que se le emitieron 5 tokens de verificación en las últimas 24 horas
  Cuando se envía POST /api/auth/resend-verification con su correo, después del enfriamiento
  Entonces el sistema responde 200 con el mismo cuerpo del Escenario 1
  Y no se crea ningún token ni ningún mensaje

Escenario 7: Correo mal formado
  Dado un cuerpo con "email": "no-es-un-correo"
  Cuando se envía POST /api/auth/resend-verification
  Entonces el sistema responde 400 con código VALIDATION_FAILED
  Y no se consulta la base de datos

Escenario 8: Correo con mayúsculas o espacios
  Dada una cuenta con correo "ana@ejemplo.com"
  Cuando se envía POST /api/auth/resend-verification con "  ANA@Ejemplo.com "
  Entonces el sistema trata el correo como "ana@ejemplo.com" y se comporta como en el Escenario 1

Escenario 9: Fallo de envío posterior
  Dado un reenvío exitoso cuyo envío SMTP falla
  Cuando el proveedor de correo no responde
  Entonces el mensaje queda en iam.email_outbox y se reintenta según la política existente
  Y el visitante ya recibió la respuesta 200 del Escenario 1

Escenario 10: El inicio de sesión sigue bloqueado hasta verificar
  Dada una cuenta sin correo verificado que solicitó un reenvío
  Cuando intenta iniciar sesión con su contraseña correcta
  Entonces el sistema responde 403 con código EMAIL_NOT_VERIFIED, según el contrato vigente de login

Escenario 11: Pantalla de verificación
  Dado un visitante en /verificar-correo sin enlace de verificación
  Cuando escribe su correo y pulsa "Reenviar enlace"
  Entonces ve el mensaje "Si la cuenta existe y no está verificada, te enviamos un nuevo enlace."
  Y el botón queda deshabilitado durante 120 segundos con el texto "Reenviar en N s"
  Y después de 120 segundos el botón vuelve a estar activo

Escenario 12: Error de red en la pantalla
  Dado un visitante en /verificar-correo
  Cuando el envío falla por red
  Entonces ve "No pudimos conectar. Intenta de nuevo." y el botón sigue activo
```

---

## 5. Contrato de API

### Endpoint: `POST /api/auth/resend-verification`

- **Autenticación requerida:** No (pública)
- **Rol requerido:** Ninguno

#### Parámetros de Entrada (DTO `ResendVerificationDto`)

```json
{
  "email": "ana@ejemplo.com"
}
```

Mismas reglas que `ForgotPasswordDto`: se recorta el espacio (`trim`), debe ser un correo válido (`IsEmail`) y tener como máximo 254 caracteres (`MaxLength(254)`).

#### Respuesta Exitosa (`200 OK`)

Idéntica en todos los casos de negocio (existe o no, verificada o no, con o sin enfriamiento):

```json
{
  "message": "Si la cuenta existe y aún no está verificada, recibirás un nuevo enlace de verificación."
}
```

#### Errores Canónicos

| Código HTTP | Error Code | Causa |
|---|---|---|
| `400 Bad Request` | `VALIDATION_FAILED` | El correo está vacío, no es válido o supera 254 caracteres. |

No hay error `429`. Los límites de enfriamiento y de tope diario se aplican en silencio, para que la respuesta no revele si una cuenta existe.

**Nota para CONTRACTS.md:** la ruta se añade a la sección de IAM como versión 0.7 (ver sección 11).

---

## 6. Datos y Esquema

- **¿Modifica el esquema de base de datos?**: No. No hay migración.
- **Tablas afectadas:**
  - `iam.user`: lectura con bloqueo de fila (`SELECT ... FOR UPDATE`) para serializar peticiones simultáneas de la misma cuenta.
  - `iam.one_time_token`: lectura de la última emisión y conteo de las últimas 24 horas; marca como usados los tokens anteriores; inserción del token nuevo.
  - `iam.email_outbox`: inserción del mensaje `email_verification`.
- **Cambio en la entidad (sin migración):** la columna `created_at` ya existe en `database/migrations/20260928090300_create_tables_iam.sql`, pero la entidad `OneTimeToken` no la mapea. Se añade la propiedad `createdAt` con `@Column({ name: 'created_at', type: 'timestamptz' })`.

---

## 7. Interfaz de Usuario (UI/UX)

- **Ruta de la pantalla:** `apps/web/src/app/verificar-correo/` (componente `VerifyForm` en `auth-forms.tsx`).
- **Cambio:** se quita la línea "El reenvío del enlace aún no forma parte del contrato de la API." y se agrega el bloque "¿No llegó el correo?" con:
  - Campo "Correo electrónico" (tipo `email`, `autoComplete="email"`).
  - Botón "Reenviar enlace".
  - Texto de ayuda: "Si ya tienes un enlace anterior, usa siempre el más reciente. El anterior deja de funcionar."
- **Estados obligatorios:**
  - **Loading:** el botón muestra "Enviando…" y está deshabilitado.
  - **Enviado:** muestra "Si la cuenta existe y no está verificada, te enviamos un nuevo enlace. Revisa también la carpeta de spam." El botón pasa a cuenta regresiva.
  - **Enfriamiento:** el botón muestra "Reenviar en N s" y está deshabilitado durante 120 segundos. Es el mismo límite que aplica el servidor.
  - **Error de red:** "No pudimos conectar. Intenta de nuevo." El botón sigue activo.
  - **Validación en cliente:** correo vacío o sin formato de correo muestra "Escribe un correo válido." y no envía la petición.
- **Regla visual:** la pantalla nunca dice si el correo existe.

---

## 8. Diseño Técnico (Obligatorio para N2)

### Firmas

```typescript
// apps/api/src/modules/iam/services/email-verification.service.ts
/** Dispara en segundo plano, como PasswordResetService.requestReset. No lanza al visitante. */
resend(rawEmail: string): Promise<void>;

// apps/api/src/modules/iam/ports/repositories.ts (OneTimeTokenRepository)
abstract latestCreatedAt(tx: TransactionContext, userId: string, purpose: TokenPurpose): Promise<Date | null>;
abstract countCreatedSince(tx: TransactionContext, userId: string, purpose: TokenPurpose, since: Date): Promise<number>;

// apps/api/src/modules/iam/constants.ts
export const RESEND_VERIFICATION_COOLDOWN_SECONDS = 120;
export const RESEND_VERIFICATION_MAX_PER_DAY = 5;
```

### Flujo de `resend`

1. Normalizar el correo con `normalizeEmail`.
2. Dentro de `uow.run(tx)`:
   1. `users.findByEmailForUpdate(email, tx)`. Si no hay cuenta, si `emailVerified` es `true` o si `status` no es `active`: terminar sin cambios y devolver `null`.
   2. `tokensRepo.latestCreatedAt(tx, userId, EMAIL_VERIFICATION)`. Si existe y la diferencia con ahora es menor que `RESEND_VERIFICATION_COOLDOWN_SECONDS`: terminar con `null`.
   3. `tokensRepo.countCreatedSince(tx, userId, EMAIL_VERIFICATION, ahora - 24 h)`. Si es mayor o igual que `RESEND_VERIFICATION_MAX_PER_DAY`: terminar con `null`. El conteo incluye el token del registro.
   4. `tokensRepo.invalidateUnused(tx, userId, EMAIL_VERIFICATION)`.
   5. `outbox.enqueueWithToken(tx, { kind: 'email_verification', userId, recipientEmail, recipientName, purpose: EMAIL_VERIFICATION, ttlMinutes: VERIFICATION_TOKEN_TTL_MINUTES })` y devolver el id.
3. Si hubo id, `void outbox.dispatch(id)` después del commit.

El bloqueo de la fila del usuario (paso 1) hace que dos peticiones simultáneas se ejecuten en serie: la segunda ve el enfriamiento de la primera.

### Controlador

```typescript
// apps/api/src/modules/iam/iam.controller.ts
@Post('resend-verification')
@HttpCode(HttpStatus.OK)
resendVerification(@Body() dto: ResendVerificationDto): { message: string };
```

Devuelve el mensaje de inmediato y llama a `resend` sin esperarlo, igual que `forgotPassword`. Así el tiempo de respuesta no depende de si la cuenta existe.

### Transaccionalidad

Una sola transacción: bloqueo del usuario, invalidación, creación del token y encolado del mensaje. El envío va después del commit.

### Auditoría

No se registra evento en esta versión (ver sección 3).

### Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Enumeración de cuentas | Respuesta idéntica en todos los casos; la lógica corre en segundo plano. |
| Spam de correos a una cuenta | Enfriamiento de 120 s y tope de 5 tokens en 24 h, por cuenta. No protege contra muchas cuentas distintas (riesgo aceptado: no hay limitador por IP). |
| Confusión con enlaces viejos | Al reenviar, los anteriores dejan de funcionar. La pantalla lo indica. |
| Fallo de la base de datos después de responder 200 | El visitante no recibe correo y debe volver a pedirlo. Es el mismo comportamiento de SPEC-103. |
| Fallo del servidor de correo | El mensaje queda en la outbox y se reintenta. Si el token vence antes del envío, la outbox lo renueva (ya existe). |
| Registro de datos sensibles | No se registran el correo ni el token en los logs; solo el nombre del error. |

---

## 9. Plan de Tareas (≤ 2 horas cada una)

- [ ] **Tarea 1 (Backend, datos)**: constantes, `ResendVerificationDto`, propiedad `createdAt` en `OneTimeToken`, y los métodos `latestCreatedAt` y `countCreatedSince` en el puerto y en la implementación TypeORM (45 min).
  *Archivos:* `apps/api/src/modules/iam/constants.ts`, `apps/api/src/modules/iam/dto/resend-verification.dto.ts` (nuevo), `apps/api/src/modules/iam/entities/one-time-token.entity.ts`, `apps/api/src/modules/iam/ports/repositories.ts`, `apps/api/src/modules/iam/infrastructure/typeorm-repositories.ts`.
- [ ] **Tarea 2 (Backend, servicio y ruta)**: `EmailVerificationService.resend` y `POST /auth/resend-verification` (45 min).
  *Archivos:* `apps/api/src/modules/iam/services/email-verification.service.ts`, `apps/api/src/modules/iam/iam.controller.ts`.
- [ ] **Tarea 3 (Pruebas)**: archivo de pruebas unitarias con los escenarios 1 a 8 y 10; prueba e2e opcional para el escenario 7 (45 min).
  *Archivos:* `apps/api/src/modules/iam/iam.resend-verification.spec.ts` (nuevo), `apps/api/test/iam.resend-verification.e2e-spec.ts` (opcional).
- [ ] **Tarea 4 (Frontend)**: cliente `resendVerification`, tipo de respuesta, bloque del formulario con estados y cuenta regresiva (45 min).
  *Archivos:* `apps/web/src/lib/api/iam.ts`, `apps/web/src/lib/api/types.ts`, `apps/web/src/components/auth-forms.tsx`, `apps/web/src/app/globals.css` (solo si hace falta un estilo).
- [ ] **Tarea 5 (Documentación)**: entrada en `SESSION_LOG.md` y ruta en `CONTRACTS.md` (15 min).

---

## 10. Estrategia de Pruebas

| Criterio de Aceptación | Tipo de Prueba | Archivo de Prueba |
|---|---|---|
| Escenarios 1 a 6 (reenvío, enumeración, verificada, inactiva, enfriamiento, tope) | Unitaria | `apps/api/src/modules/iam/iam.resend-verification.spec.ts` |
| Escenario 7 (400 por correo inválido) | Unitaria (DTO) y e2e opcional | `iam.resend-verification.spec.ts`, `apps/api/test/iam.resend-verification.e2e-spec.ts` |
| Escenario 8 (normalización del correo) | Unitaria | `iam.resend-verification.spec.ts` |
| Escenario 9 (fallo de envío y reintento) | Unitaria | `iam.resend-verification.spec.ts` (con la outbox simulada) |
| Escenario 10 (inicio de sesión bloqueado) | Unitaria (regresión) | `apps/api/src/modules/iam/iam.session.spec.ts` |
| Escenarios 11 y 12 (pantalla) | Manual en navegador | Lista de verificación en `SESSION_LOG.md` |
| Aislamiento: la respuesta es igual con y sin cuenta | Unitaria | `iam.resend-verification.spec.ts` (compara los cuerpos) |

---

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md`: añadir `POST /auth/resend-verification` en la sección de IAM (versión 0.7).
- [ ] `specs/README.md`: marcar SPEC-116 como implementada cuando se fusione.
- [ ] `SESSION_LOG.md`: registrar la prueba manual de los escenarios 11 y 12.

---

## 12. Preguntas Abiertas

Ninguna. Valores confirmados por Víctor: enfriamiento de 120 s, tope de 5 tokens en 24 h, formulario solo en `/verificar-correo`.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-09 | Revisión de coordinación | Versión inicial en borrador a partir del estado de `origin/main` (`58be6a5`). |
| 2026-11-10 | Miguel | Implementación, pruebas y evidencia. Se corrige el estado HTTP del escenario 10 para reflejar el contrato vigente de login (403). |
