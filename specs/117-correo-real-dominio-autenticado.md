# SPEC-117: CORREO REAL CON GMAIL SMTP

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
| **Estimación** | 5 h |
| **Hito Objetivo** | Entrega final del curso |
| **Estado** | Aprobada (2026-11-10) |

---

## 2. Objetivo

Hoy los correos de verificación, recuperación e invitación solo llegan a Mailpit, un buzón local: nadie fuera de la máquina los recibe. El instructivo de despliegue usa `sandbox.smtp.mailtrap.io`, que es el buzón de pruebas de Mailtrap y tampoco entrega a cuentas reales.

Esta spec cambia el envío a **Gmail SMTP**, con una cuenta de Gmail del proyecto, para que verificación, recuperación e invitación lleguen a cualquier buzón sin costo. Gmail firma sus propios correos con SPF y DKIM del dominio `gmail.com` y cumple DMARC, así que el equipo no necesita dominio propio. Además, el registro y el alta de miembros comprueban que el dominio del destinatario pueda recibir correo.

---

## 3. Fuera de Alcance (YAGNI)

- No se cambia el transporte: sigue siendo SMTP con nodemailer (`EmailService`). No se usa la API de Gmail ni OAuth, solo SMTP con contraseña de aplicación.
- No se procesan rebotes, quejas ni eventos de entrega. Se revisan en la bandeja de la cuenta de Gmail.
- No se comprueba que el buzón exista antes de enviar. Esa prueba la da el enlace de verificación, que solo funciona si la persona lo abre.
- No se limita el registro a dominios corporativos de cada organización (por ejemplo, solo `@empresa.com`). Decidido (§12, punto 5).
- No se bloquean correos desechables ni listas de dominios prohibidos.
- No se publican registros DNS. El proyecto no tiene dominio propio.
- No se valida el dominio en `POST /auth/forgot-password` ni en `POST /auth/resend-verification` (SPEC-116). Esas rutas responden lo mismo exista o no el correo, y no deben revelar nada por DNS.
- Mailpit se mantiene para desarrollo local.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Producción no arranca con correo local o mal configurado
  Dado que NODE_ENV es "production"
  Y que MAIL_HOST es "localhost" o "mailpit", o que MAIL_FROM es distinto de MAIL_USER
  Cuando arranca la API
  Entonces el arranque falla con el código MAIL_CONFIG_INVALID
  Y el mensaje nombra la variable incorrecta sin mostrar su valor ni el de MAIL_PASS

Escenario 2: TLS obligatorio
  Dado que MAIL_REQUIRE_TLS es "true" y MAIL_HOST es smtp.gmail.com en el puerto 587
  Cuando se envía un correo de verificación
  Entonces la conexión usa STARTTLS
  Y si el servidor no lo ofrece, el envío falla sin transmitir el contenido en claro
  Y el mensaje queda en iam.email_outbox para reintento

Escenario 3: Configuración verificada
  Dado que MAIL_USER y MAIL_FROM son la cuenta Gmail del proyecto, con verificación en dos pasos y contraseña de aplicación
  Cuando se ejecuta "npm run mail:check -- --to <buzón real>"
  Entonces el script confirma que el inicio de sesión SMTP funciona
  Y envía un correo de prueba
  Y termina con código 0

Escenario 4: Credenciales incorrectas
  Dado que MAIL_PASS es la contraseña normal de Gmail, o una contraseña de aplicación revocada
  Cuando se ejecuta "npm run mail:check -- --to <buzón real>"
  Entonces el script indica un error de autenticación sin mostrar la contraseña
  Y no envía el correo de prueba
  Y termina con código 2

Escenario 5: Autenticidad comprobada en el buzón
  Dado el correo de prueba recibido en un buzón real
  Cuando se revisa su encabezado Authentication-Results
  Entonces aparecen spf=pass, dkim=pass y dmarc=pass
  Y el dominio del remitente es gmail.com y coincide con la cuenta de MAIL_USER
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

Escenario 13: Límite diario de Gmail
  Dado que la cuenta alcanzó el límite diario de envíos de Gmail
  Cuando se intenta enviar un correo de verificación
  Entonces el envío falla y el mensaje queda en iam.email_outbox para reintento
  Y no se pierde la operación de origen (registro, recuperación o invitación)
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

### 8.1 Proveedor, cuenta y remitente

- **Proveedor.** Decidido: **Gmail SMTP** (2026-11-10), con `smtp.gmail.com`, puerto `587` y STARTTLS. Es gratis y no necesita dominio propio. Así `EmailService` no cambia de transporte.
  - **Brevo queda descartado:** sin dominio propio reescribe el remitente a `brevosend.com`, y según su documentación el correo puede caer en spam o ser rechazado.
  - **Resend queda descartado:** sin dominio verificado solo entrega a la dirección de la cuenta dueña.
- **Cuenta de Gmail.** Antes de T1 el equipo elige una de estas dos opciones:
  - **Opción A (recomendada): cuenta nueva del proyecto.** Una cuenta de Gmail creada para el equipo. Si una persona deja el proyecto, el envío sigue funcionando.
  - **Opción B: cuenta personal existente** de un integrante. Funciona igual, pero el correo sale con esa persona. Si cambia su contraseña de Gmail, la contraseña de aplicación se revoca y el envío se detiene.
  - **Requisitos en cualquiera de las dos:** verificación en dos pasos activa, una contraseña de aplicación de 16 caracteres generada para la API, y esa contraseña guardada solo en variables de entorno, nunca en Git ni en logs.
- **Remitente.** `MAIL_FROM` debe ser la misma dirección que `MAIL_USER`. Gmail reemplaza cualquier otro remitente por la cuenta autenticada.
- **Autenticación.** Gmail firma sus correos con SPF y DKIM del dominio `gmail.com`, y DMARC se cumple. No hay registros DNS que configurar.
- **Límite.** Una cuenta personal de Gmail envía unos 500 correos al día. Esa cifra viene de fuentes de terceros, no de la documentación de Google. Para el curso es suficiente. Si se supera, el envío se reintenta desde la outbox (Escenario 13).
- **Clave SMTP.** Es la contraseña de aplicación, no la contraseña normal de la cuenta.

### 8.2 Variables de entorno

| Variable | Ejemplo | Función |
|---|---|---|
| `MAIL_HOST` | `smtp.gmail.com` | Servidor de Gmail. En producción no puede ser `localhost` ni `mailpit`. |
| `MAIL_PORT` | `587` | Puerto con STARTTLS. |
| `MAIL_SECURE` | `false` | `true` solo para el puerto 465. |
| `MAIL_REQUIRE_TLS` | `true` | Obliga STARTTLS (opción `requireTLS` de nodemailer). Por defecto `true` si `NODE_ENV` es `production`. |
| `MAIL_USER` | `<cuenta>@gmail.com` | Cuenta de Gmail del proyecto (o la personal elegida). |
| `MAIL_PASS` | contraseña de aplicación de 16 caracteres | No es la contraseña normal de Gmail. |
| `MAIL_FROM` | `Nexus <<cuenta>@gmail.com>` | Igual que `MAIL_USER`. |
| `IAM_CHECK_EMAIL_DOMAIN` | `true` | Activa la validación de dominio en registro y alta de miembros. `false` solo en pruebas. |

### 8.3 Configuración segura

- **`apps/api/src/modules/iam/infrastructure/mail-config.ts` (nuevo):** función pura `assertMailConfig(env)`. Lanza `MAIL_CONFIG_INVALID` en producción si se cumple alguna de estas condiciones:
  - `MAIL_HOST` es `localhost`, `127.0.0.1` o `mailpit`.
  - `MAIL_FROM` es distinto de `MAIL_USER`. Gmail reemplazaría el remitente.
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

### 8.5 Prueba de envío: `npm run mail:check`

Script `apps/api/src/scripts/mail-check.ts`, expuesto como `mail:check` en `package.json`. No corre dentro de la API. Pasos:

1. Lee `MAIL_HOST`, `MAIL_USER` y `MAIL_FROM`, y aplica las reglas de §8.3. Si falla, termina con código `2`.
2. Abre una conexión SMTP con `transporter.verify()`, que comprueba el usuario y la contraseña de aplicación. Si falla, muestra el error de autenticación sin mostrar la contraseña y termina con código `2`.
3. Envía un correo de prueba con `createMailTransport` a `--to`. Imprime el `messageId` y la respuesta del servidor.
4. Indica revisar `Authentication-Results` en el buzón recibido (Escenario 5). Termina con código `0`.

- **Códigos de salida:** `0` correcto, `2` configuración inválida, autenticación fallida o envío fallido.
- **Función pura** `checkSenderMatches(config)`, que se prueba sin red.

### 8.6 Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Gmail bloquea la cuenta por actividad automatizada. | Usar una cuenta dedicada (Opción A), con volumen bajo. Revisar los avisos que Google envía a la cuenta. |
| Se alcanza el límite diario de envíos (unos 500). | La outbox reintenta con espera creciente (Escenario 13). En el curso el volumen es bajo. |
| Con la Opción B, si la persona cambia su contraseña, el envío se detiene. | Recomendar la Opción A. Si se usa la B, documentar la dependencia. |
| El guard de producción impide arrancar si el despliegue tiene `MAIL_HOST=localhost` (como el instructivo con Mailpit). | Actualizar las variables antes del despliegue y ejecutar `mail:check` antes. |
| El instructivo usa `sandbox.smtp.mailtrap.io`, que no entrega a buzones reales. | Reemplazar `MAIL_HOST`, `MAIL_PORT` y las credenciales por las de Gmail (§11). |

---

## 9. Plan de Tareas (≤ 2 horas cada una)

- [ ] **T1 (30 min, equipo, sin código):** elegir la cuenta (Opción A o B de §8.1), activar la verificación en dos pasos y generar la contraseña de aplicación.
- [ ] **T2 (1.5 h):** `mail-config.ts` con las reglas de §8.3, `mail-transport.ts` y `requireTLS` en `EmailService`. Pruebas unitarias.
- [ ] **T3 (1 h):** `mail-check.ts` con `checkSenderMatches`, la verificación SMTP y el envío de prueba. Pruebas de la función pura.
- [ ] **T4 (1.5 h):** `EmailDomainChecker`, adaptador DNS con tiempo límite, `IamSettings.checkEmailDomain`, integración en registro y alta de miembros, y pruebas.
- [ ] **T5 (0.5 h):** actualizar `CONTRACTS.md`, la enmienda de ADR-003, `.env.example`, `specs/README.md` y las líneas de Mailtrap del instructivo.

**Archivos permitidos:** `apps/api/src/modules/iam/infrastructure/mail-config.ts` y `mail-config.spec.ts` (nuevos), `infrastructure/mail-transport.ts` (nuevo), `infrastructure/email.service.ts`, `infrastructure/dns-email-domain-checker.ts` y su spec (nuevos), `ports/email-domain-checker.ts` (nuevo), `iam.settings.ts`, `iam.module.ts`, `iam.errors.ts`, `services/registration.service.ts`, `services/members.service.ts`, `apps/api/src/scripts/mail-check.ts` y su spec (nuevos), `package.json` (script `mail:check`), `.env.example`, `CONTRACTS.md`, `docs/decisions/ADR-003-detalles-operativos-aprobados.md`, `specs/README.md`, `INSTRUCTIVO_SEBASTIAN_DESPLIEGUE_Y_PRESENTACION.md` (solo las líneas de correo).

**Coordinación:** SPEC-115 también edita `infrastructure/email.service.ts`, y SPEC-116 toca `iam/`. Fusionar una y actualizar la otra antes de programar.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1 y 2 | Unitaria | `mail-config.spec.ts` y `email.service.spec.ts` (opción `requireTLS` del transporte) |
| Escenarios 3 y 4 | Unitaria | `mail-check.spec.ts` sobre `checkSenderMatches` y la verificación SMTP con transporte simulado |
| Escenario 5 | Manual | Captura de `Authentication-Results` en el PR |
| Escenarios 6 a 10 | Unitaria | `dns-email-domain-checker.spec.ts` (resolver simulado) e `iam.registration.spec.ts`, más las pruebas de alta de miembros |
| Escenario 11 | Unitaria | Prueba que confirma que el validador no se llama en recuperación ni reenvío |
| Escenario 12 | Unitaria | Captura de logs en las pruebas de envío y de `mail:check` |
| Escenario 13 | Unitaria | `iam.outbox.spec.ts` (existente): un error del proveedor deja el mensaje pendiente para reintento |
| Envío real | Manual | Correo recibido en Gmail y en Outlook |

---

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md`, sección "Alcance final [v0.6]": código `EMAIL_DOMAIN_INVALID` en registro y alta de miembros.
- [ ] `docs/decisions/ADR-003-detalles-operativos-aprobados.md`: enmienda con Gmail SMTP como proveedor, la cuenta elegida y la regla de validación. No se agrega librería, así que no hace falta un ADR nuevo.
- [ ] `.env.example`: variables de Gmail, sin credenciales.
- [ ] `specs/README.md`: agregar SPEC-117 al catálogo, en la sección 1xx.
- [ ] `INSTRUCTIVO_SEBASTIAN_DESPLIEGUE_Y_PRESENTACION.md`: reemplazar `sandbox.smtp.mailtrap.io` (líneas 170 a 173 y 743) y `MAIL_HOST=localhost` (líneas 399 a 401) por los valores de Gmail.
- [ ] `REGLAS.md`: aclarar que Mailpit es solo para desarrollo local y que producción usa Gmail SMTP.

---

## 12. Preguntas Abiertas

1. **Proveedor. Resuelto:** Gmail SMTP (2026-11-10). Brevo y Resend quedan descartados.
2. **Dominio. Resuelto:** no hay dominio propio. Se usa la cuenta de Gmail.
3. **Resuelto:** no desplegar con Mailpit. La guarda de §8.3 se mantiene.
4. **Resuelto:** si la consulta DNS falla, se deja pasar el registro (`unknown`) y se escribe una advertencia.
5. **Resuelto:** cualquier correo válido puede usarse. No se limita al dominio de la organización.
6. **Resuelto:** el nombre genérico de validación es `VALIDATION_ERROR`, como en `CONTRACTS.md`. SPEC-116 debe corregirse, porque hoy usa `VALIDATION_FAILED`.
7. **Pendiente de elegir antes de T1:** la cuenta de Gmail. Opción A: cuenta nueva del proyecto (recomendada). Opción B: cuenta personal existente de un integrante. Ver §8.1.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-10 | Claude Code (borrador) | Versión inicial. Hosts SMTP de Brevo verificados en su documentación pública. |
| 2026-11-10 | Claude Code (borrador) | Proveedor decidido: Brevo. Resend descartado. |
| 2026-11-10 | Claude Code (borrador) | Decididos: no desplegar con Mailpit (punto 3), fallo DNS deja pasar (punto 4), sin restricción por dominio (punto 5), `VALIDATION_ERROR` (punto 6). |
| 2026-11-10 | Claude Code (borrador) | Cambio a Gmail SMTP: sin dominio propio, Brevo y Resend quedan descartados. Se reescriben §1, §2, §3, §4 (criterios 1 a 5), §8.1 a §8.6 y §9. Se agrega el criterio 13 (límite diario). Pendiente: elegir la cuenta de Gmail (§8.1). |
| 2026-11-10 | Víctor Chán Morales | Aprobada. La cuenta de Gmail se elige antes de T1 (§8.1, pregunta 7). |
