# SPEC-117: CORREO REAL CON DOMINIO AUTENTICADO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (Zona protegida: IAM, registro y correo) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/` (infraestructura de correo, registro y alta de miembros), `apps/api/src/scripts/`, `package.json`, `.env.example`, `CONTRACTS.md`, `docs/decisions/ADR-003-detalles-operativos-aprobados.md` |
| **Requisitos Vinculados** | RF-001, Curso §4.1, ADR-003 (Identidad y correo) |
| **Dependencias** | SPEC-103 y SPEC-108 (correos existentes). Coordina con SPEC-115 y SPEC-116, que también tocan `iam/` |
| **Prioridad** | P1 |
| **Estimación** | 6 h |
| **Hito Objetivo** | Despliegue público (10-Nov-2026). Si el dominio no está listo, la limitación se declara |
| **Estado** | Borrador |

---

## 2. Objetivo

Hoy los correos de verificación, recuperación e invitación solo llegan a Mailpit, un buzón local: nadie fuera de la máquina los recibe. El instructivo de despliegue usa `sandbox.smtp.mailtrap.io`, que es el buzón de pruebas de Mailtrap y tampoco entrega a cuentas reales.

Esta spec cambia el envío a un proveedor transaccional real y agrega dos comprobaciones de autenticidad: que el dominio remitente esté autenticado con SPF, DKIM y DMARC, y que el dominio del destinatario pueda recibir correo. Así los mensajes llegan a bandejas reales y no se rechazan ni caen en spam.

---

## 3. Fuera de Alcance (YAGNI)

- No se cambia el transporte: sigue siendo SMTP con nodemailer (`EmailService`). No se integra la API HTTP de ningún proveedor ni se agrega librería.
- No se procesan rebotes, quejas ni eventos de entrega por webhook. Se revisan en el panel del proveedor.
- No se comprueba que el buzón exista antes de enviar. Esa prueba la da el enlace de verificación, que solo funciona si la persona lo abre.
- No se limita el registro a dominios corporativos de cada organización (por ejemplo, solo `@empresa.com`). Decidido (§12, punto 5).
- No se bloquean correos desechables ni listas de dominios prohibidos.
- El código no publica registros DNS. Los registros los crea el responsable del dominio en su proveedor de dominio.
- No se valida el dominio en `POST /auth/forgot-password` ni en `POST /auth/resend-verification` (SPEC-116). Esas rutas responden lo mismo exista o no el correo, y no deben revelar nada por DNS.
- Mailpit se mantiene para desarrollo local.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Producción no arranca con correo local
  Dado que NODE_ENV es "production"
  Y que MAIL_HOST es "localhost", o que MAIL_FROM usa un dominio "localhost", ".local", ".test" o ".invalid"
  Cuando arranca la API
  Entonces el arranque falla con el código MAIL_CONFIG_INVALID
  Y el mensaje nombra la variable incorrecta sin mostrar su valor ni el de MAIL_PASS

Escenario 2: TLS obligatorio
  Dado que MAIL_REQUIRE_TLS es "true"
  Cuando se envía un correo a un servidor que no ofrece STARTTLS
  Entonces el envío falla sin transmitir el contenido en claro
  Y el mensaje queda en iam.email_outbox para reintento

Escenario 3: Remitente autenticado
  Dado que el dominio de MAIL_FROM publica SPF, DKIM (con el selector de MAIL_DKIM_SELECTOR) y DMARC válidos
  Cuando se ejecuta "npm run mail:check -- --to <buzón real>"
  Entonces el script reporta los tres registros como correctos
  Y envía un correo de prueba y termina con código 0

Escenario 4: Remitente sin autenticación
  Dado que falta el registro DKIM o DMARC del dominio de MAIL_FROM
  Cuando se ejecuta "npm run mail:check -- --to <buzón real>"
  Entonces el script indica el nombre y el tipo del registro que falta
  Y no envía el correo de prueba
  Y termina con código distinto de 0

Escenario 5: Autenticidad comprobada en el buzón
  Dado el correo de prueba recibido en un buzón real
  Cuando se revisa su encabezado Authentication-Results
  Entonces aparecen spf=pass, dkim=pass y dmarc=pass
  Y el dominio del remitente coincide con el de MAIL_FROM
  (Verificación manual. La captura del encabezado va en el PR.)

Escenario 6: Dominio del destinatario sin correo
  Dado un alta con un correo cuyo dominio no tiene registros MX ni A
  Cuando se envía POST /auth/register
  Entonces el sistema responde 400 con código EMAIL_DOMAIN_INVALID
  Y no crea organización, usuario, membresía ni mensaje en la outbox

Escenario 7: Dominio con MX o solo con A
  Dado un correo cuyo dominio tiene registros MX, o solo un registro A o AAAA (RFC 5321 §5.1)
  Cuando se envía POST /auth/register
  Entonces el registro continúa como hoy

Escenario 8: Dominio con MX nulo
  Dado un dominio cuyo único registro MX es "." con prioridad 0 (RFC 7505)
  Cuando se valida el correo
  Entonces el dominio se trata como inválido y responde EMAIL_DOMAIN_INVALID

Escenario 9: Falla temporal de DNS
  Dado que la consulta DNS agota 3 segundos o responde SERVFAIL
  Cuando se envía POST /auth/register
  Entonces el registro continúa
  Y se escribe una advertencia con el dominio, sin el correo completo

Escenario 10: El alta de miembros usa la misma regla
  Dado un tenant_admin autenticado
  Cuando envía POST /organizations/members con un correo de dominio inválido
  Entonces el sistema responde 400 con código EMAIL_DOMAIN_INVALID
  Y no crea usuario ni membresía

Escenario 11: Rutas públicas sin consulta DNS
  Dado un correo de dominio inválido
  Cuando se envía POST /auth/forgot-password o POST /auth/resend-verification
  Entonces la respuesta es la misma que con un correo válido
  Y no se realiza ninguna consulta DNS

Escenario 12: Sin datos sensibles
  Entonces ni los logs del envío ni la salida de mail:check muestran MAIL_PASS, tokens ni enlaces de verificación
```

---

## 5. Contrato de API

No se agregan rutas. Cambia el error posible de dos rutas existentes:

| Ruta | Error nuevo | Causa |
|---|---|---|
| `POST /auth/register` | `400 EMAIL_DOMAIN_INVALID` | El dominio del correo no tiene registros MX ni A, o su MX es nulo. El correo no se puede entregar. |
| `POST /organizations/members` | `400 EMAIL_DOMAIN_INVALID` | Mismo caso. |

- Las respuestas de éxito no cambian.
- `POST /auth/forgot-password` y `POST /auth/resend-verification` no cambian.
- La validación es entrada, no regla de negocio, por eso es `400` y no `422`. El nombre genérico de validación es `VALIDATION_ERROR` (§12, punto 6).

---

## 6. Datos y Esquema

- **¿Modifica el esquema de base de datos?** No.
- **Tablas afectadas:** ninguna. `iam.email_outbox` y sus tipos (`ck_email_outbox_kind`) no cambian.

---

## 7. Interfaz de Usuario (UI/UX)

- **Pantallas afectadas:** formulario de registro (`apps/web/src/components/auth-forms.tsx`) y formulario de alta de miembros en `/configuracion`.
- **Estado de error:** mensaje en español debajo del campo de correo, por ejemplo: "Este correo no puede recibir mensajes. Revisa que el dominio esté bien escrito."
- **Estado de carga:** no hay uno nuevo. La comprobación DNS dura como máximo 3 segundos dentro de la espera que ya muestra el formulario.
- **Sin pantalla nueva.**

---

## 8. Diseño Técnico (Obligatorio para N2)

### 8.1 Proveedor y remitente

- **Proveedor.** Decidido: **Brevo** (2026-11-10). ADR-003 permite Resend o Brevo para demostración. Se usa `smtp-relay.brevo.com`, puerto `587` y STARTTLS (documentación pública de Brevo, *SMTP relay integration*). Así `EmailService` no cambia de transporte. Resend queda descartado para esta spec.
- **Remitente.** `MAIL_FROM` debe usar un dominio que el equipo controla y que tiene autenticación DNS. Se recomienda un subdominio dedicado, por ejemplo `Nexus <no-reply@notificaciones.<dominio>>`. Sin dominio propio:
  - Brevo reescribe el remitente a un subdominio de `brevosend.com`. Según su documentación, el riesgo de spam o rechazo es alto, y no autentica correos de proveedores gratuitos como Gmail.
  - `onboarding@resend.dev`, el remitente de prueba de Resend, solo entrega a la dirección de la cuenta dueña.
- **Clave SMTP.** Brevo la genera en la sección SMTP de la cuenta y es distinta de la API key. El usuario puede ser el correo de la cuenta o una dirección `[ID]@smtp-brevo.com`, según la cuenta. Se guarda solo en variables de entorno, nunca en Git ni en logs (ADR-003).

### 8.2 Variables de entorno

| Variable | Ejemplo | Función |
|---|---|---|
| `MAIL_HOST` | `smtp-relay.brevo.com` | Servidor del proveedor. En producción no puede ser `localhost`. |
| `MAIL_PORT` | `587` | Puerto con STARTTLS. |
| `MAIL_SECURE` | `false` | `true` solo para el puerto 465. |
| `MAIL_REQUIRE_TLS` | `true` | Obliga STARTTLS (opción `requireTLS` de nodemailer). Por defecto `true` si `NODE_ENV` es `production`. |
| `MAIL_USER` / `MAIL_PASS` | de la cuenta del proveedor | Credenciales SMTP. |
| `MAIL_FROM` | `Nexus <no-reply@notificaciones.<dominio>>` | Remitente con dominio autenticado. |
| `MAIL_DKIM_SELECTOR` | según el proveedor | Selector que usa `mail:check` para buscar el registro DKIM. |
| `IAM_CHECK_EMAIL_DOMAIN` | `true` | Activa la validación de dominio en registro y alta de miembros. `false` solo en pruebas. |

### 8.3 Configuración segura

- **`apps/api/src/modules/iam/infrastructure/mail-config.ts` (nuevo):** función pura `assertMailConfig(env)`. Lanza `MAIL_CONFIG_INVALID` en producción si se cumple alguna de estas condiciones:
  - `MAIL_HOST` es `localhost`, `127.0.0.1` o `mailpit`.
  - El dominio de `MAIL_FROM` termina en `localhost`, `.local`, `.test` o `.invalid`. Ninguno de ellos admite registros DNS de autenticación.
  - `MAIL_REQUIRE_TLS` no es `true`.
  - Faltan `MAIL_USER` o `MAIL_PASS`.
- **`infrastructure/mail-transport.ts` (nuevo):** extrae `createMailTransport(config)` de `EmailService`. Lo usan la API y `mail:check`, así ambos envían igual.
- **`EmailService`:** llama a `assertMailConfig` en el constructor, así la API no arranca con una configuración inválida. Pasa `requireTLS` a nodemailer.

### 8.4 Validación del dominio del destinatario

- **Puerto nuevo** `ports/email-domain-checker.ts`:

```typescript
export type DomainVerdict = 'deliverable' | 'undeliverable' | 'unknown';

export abstract class EmailDomainChecker {
  abstract check(domain: string): Promise<DomainVerdict>;
}
```

- **Adaptador** `infrastructure/dns-email-domain-checker.ts`, con `node:dns/promises`:
  1. `resolveMx(domain)`. Si hay MX y no es nulo, el veredicto es `deliverable`.
  2. Si el DNS responde `ENODATA` (existe el dominio pero no tiene MX), se prueba `resolve4`/`resolve6`. Si hay registro A o AAAA, el veredicto es `deliverable` (RFC 5321 §5.1). Si no, `undeliverable`.
  3. Si responde `ENOTFOUND` (no existe el dominio), el veredicto es `undeliverable`.
  4. MX nulo (`.` con prioridad 0, RFC 7505) es `undeliverable`.
  5. Cualquier otro error, o más de 3 segundos, es `unknown`.
- **Política:** `unknown` deja pasar el registro y escribe una advertencia con el dominio. `undeliverable` responde `400 EMAIL_DOMAIN_INVALID`. Una caída de DNS no debe impedir registros legítimos.
- **Dónde se llama:** en `RegistrationService.register` y `MembersService.add`, después de validar el DTO y **antes** de abrir la transacción. Así ninguna consulta DNS retiene la transacción. Solo se llama si `IamSettings.checkEmailDomain` es `true`.
- **Configuración:** `IamSettings` agrega `checkEmailDomain`. Los servicios no leen variables de entorno, según el comentario de `iam.settings.ts`.
- **Auditoría:** ninguna. Es un rechazo de entrada, no un evento de negocio. Solo se escribe un log sin el correo completo.

### 8.5 Comprobación del remitente: `npm run mail:check`

Script `apps/api/src/scripts/mail-check.ts`, expuesto como `mail:check` en `package.json`. No corre dentro de la API. Pasos:

1. Lee `MAIL_FROM` y extrae el dominio `D`. Si el dominio no es publicable (ver §8.3), termina con error.
2. **SPF:** el TXT de `D` empieza por `v=spf1`, incluye al menos un `include:`, `a` o `mx`, y no contiene `+all`. Un `?all` produce advertencia.
3. **DKIM:** el TXT de `${MAIL_DKIM_SELECTOR}._domainkey.D` contiene `v=DKIM1` y un `p=` no vacío.
4. **DMARC:** el TXT de `_dmarc.D` contiene `v=DMARC1`. `p=none` produce advertencia (solo monitoreo). `p=quarantine` o `p=reject` son correctos.
5. Si falta algún registro obligatorio (SPF, DKIM o DMARC), imprime nombre, tipo, valor encontrado y "no encontrado", y termina con código `1`. **No envía el correo de prueba.**
6. Si todo es correcto, envía un correo de prueba con `createMailTransport` a `--to`. Imprime el `messageId` y la respuesta del servidor. Indica revisar `Authentication-Results` en el buzón recibido (Escenario 5). Termina con código `0`.

- **Códigos de salida:** `0` correcto, `1` registros de autenticación incompletos, `2` configuración inválida o fallo de envío.
- **Funciones puras** `evaluateSpf`, `evaluateDkim` y `evaluateDmarc`, que reciben los TXT ya resueltos. Así se prueban sin red.

### 8.6 Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| No hay dominio propio, así que no hay autenticación ni envío real. | Decidirlo antes de T1 (§12, punto 2). Sin dominio, la demo usa Mailpit y se declara. |
| La propagación DNS y la verificación del proveedor pueden tardar horas y no terminar el 10-Nov. | T1 arranca con los registros DNS, sin esperar al código. |
| El guard de producción impide arrancar si el despliegue tiene `MAIL_HOST=localhost` (como el instructivo con Mailpit). | Actualizar las variables antes del despliegue y ejecutar `mail:check` antes. Ver §12, punto 3. |
| Dominio nuevo sin reputación: al principio los correos pueden ir a spam. | El volumen de la demo es bajo. Revisar `Authentication-Results` y subir DMARC de `none` a `quarantine` cuando el correo llegue bien. |
| Gmail y Outlook exigen autenticación. Sin SPF, DKIM y DMARC los correos se rechazan o se marcan como spam. | `mail:check` bloquea el envío hasta que los registros estén completos. |
| El instructivo usa `sandbox.smtp.mailtrap.io`, que no entrega a buzones reales. | Reemplazar `MAIL_HOST` y `MAIL_PORT` por los del proveedor elegido (§11). |

---

## 9. Plan de Tareas (≤ 2 horas cada una)

- [ ] **T1 (1 h, responsable del dominio, sin código):** elegir el proveedor (§12), crear la cuenta, verificar un subdominio dedicado, publicar SPF, DKIM y DMARC, y obtener la clave SMTP.
- [ ] **T2 (1.5 h):** `mail-config.ts` con las reglas de producción, `mail-transport.ts` y `requireTLS` en `EmailService`. Pruebas unitarias.
- [ ] **T3 (1.5 h):** `mail-check.ts` con `evaluateSpf`, `evaluateDkim`, `evaluateDmarc` y el envío de prueba. Pruebas de las funciones de evaluación.
- [ ] **T4 (1.5 h):** `EmailDomainChecker`, adaptador DNS con tiempo límite, `IamSettings.checkEmailDomain`, integración en registro y alta de miembros, y pruebas.
- [ ] **T5 (0.5 h):** actualizar `CONTRACTS.md`, la enmienda de ADR-003, `.env.example`, `specs/README.md` y las líneas de Mailtrap del instructivo.

**Archivos permitidos:** `apps/api/src/modules/iam/infrastructure/mail-config.ts` y `mail-config.spec.ts` (nuevos), `infrastructure/mail-transport.ts` (nuevo), `infrastructure/email.service.ts`, `infrastructure/dns-email-domain-checker.ts` y su spec (nuevos), `ports/email-domain-checker.ts` (nuevo), `iam.settings.ts`, `iam.module.ts`, `iam.errors.ts`, `services/registration.service.ts`, `services/members.service.ts`, `apps/api/src/scripts/mail-check.ts` y su spec (nuevos), `package.json` (script `mail:check`), `.env.example`, `CONTRACTS.md`, `docs/decisions/ADR-003-detalles-operativos-aprobados.md`, `specs/README.md`, `INSTRUCTIVO_SEBASTIAN_DESPLIEGUE_Y_PRESENTACION.md` (solo las líneas de correo).

**Coordinación:** SPEC-115 también edita `infrastructure/email.service.ts`, y SPEC-116 toca `iam/`. Fusionar una y actualizar la otra antes de programar.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1 y 2 | Unitaria | `mail-config.spec.ts` y `email.service.spec.ts` (opción `requireTLS` del transporte) |
| Escenarios 3 y 4 | Unitaria | `mail-check.spec.ts` sobre `evaluateSpf`, `evaluateDkim` y `evaluateDmarc` con registros simulados |
| Escenario 5 | Manual | Captura de `Authentication-Results` en el PR |
| Escenarios 6 a 10 | Unitaria | `dns-email-domain-checker.spec.ts` (resolver simulado) e `iam.registration.spec.ts`, más las pruebas de alta de miembros |
| Escenario 11 | Unitaria | Prueba que confirma que el validador no se llama en recuperación ni reenvío |
| Escenario 12 | Unitaria | Captura de logs en las pruebas de envío y de `mail:check` |
| Envío real | Manual | Correo recibido en Gmail y en Outlook |

---

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md`, sección "Alcance final [v0.6]": código `EMAIL_DOMAIN_INVALID` en registro y alta de miembros.
- [ ] `docs/decisions/ADR-003-detalles-operativos-aprobados.md`: enmienda con el proveedor elegido, el dominio remitente y la regla de validación. No se agrega librería, así que no hace falta un ADR nuevo.
- [ ] `.env.example`: variables nuevas, sin credenciales.
- [ ] `specs/README.md`: agregar SPEC-117 al catálogo, en la sección 1xx.
- [ ] `INSTRUCTIVO_SEBASTIAN_DESPLIEGUE_Y_PRESENTACION.md`: reemplazar `sandbox.smtp.mailtrap.io` (líneas 170 a 173 y 743) y `MAIL_HOST=localhost` (líneas 399 a 401).
- [ ] `REGLAS.md`: aclarar que Mailpit es solo para desarrollo local y que producción usa el proveedor real.

---

## 12. Preguntas Abiertas

1. **Proveedor. Resuelto:** **Brevo** (2026-11-10). Resend queda descartado.
2. **Resuelto:** conseguir un dominio gratis, por ejemplo el `.me` del GitHub Student Developer Pack, si sigue vigente. Pendiente de confirmar en education.github.com/pack. Descartadas: enviar desde `brevosend.com` y desactivar la verificación de correo.
3. **Resuelto:** no desplegar con Mailpit. La guarda de §8.3 se mantiene.
4. **Resuelto:** si la consulta DNS falla, se deja pasar el registro (`unknown`) y se escribe una advertencia.
5. **Resuelto:** cualquier correo válido puede usarse. No se limita al dominio de la organización.
6. **Resuelto:** el nombre genérico de validación es `VALIDATION_ERROR`, como en `CONTRACTS.md`. SPEC-116 debe corregirse, porque hoy usa `VALIDATION_FAILED`.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-10 | Claude Code (borrador) | Versión inicial. Hosts SMTP de Brevo verificados en su documentación pública. |
| 2026-11-10 | Claude Code (borrador) | Proveedor decidido: Brevo. Resend descartado. |
| 2026-11-10 | Claude Code (borrador) | Decididos: no desplegar con Mailpit (punto 3), fallo DNS deja pasar (punto 4), sin restricción por dominio (punto 5), `VALIDATION_ERROR` (punto 6). Dominio remitente resuelto (punto 2): conseguir un dominio gratis, pendiente de confirmar la oferta. |
