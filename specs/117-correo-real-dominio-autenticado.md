# SPEC-117: CORREO REAL CON LA API DE GMAIL

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
| **Estado** | Aprobada |

---

## 2. Objetivo

Nexus enviará correos de verificación, recuperación, invitación y avisos de cuenta a buzones reales mediante la **API de Gmail por HTTPS (puerto 443)**. La API de Nexus está en Render Free, que bloquea la salida SMTP por los puertos `25`, `465` y `587`. El envío usará la cuenta Gmail dedicada del proyecto y la autenticación del dominio `gmail.com`. Registro y alta de miembros validarán el dominio del destinatario. [Restricciones de Render Free](https://render.com/docs/free#other-limitations) y [envío con la API de Gmail](https://developers.google.com/workspace/gmail/api/guides/sending).

---

## 3. Fuera de Alcance (YAGNI)

- OAuth se usa exclusivamente para autorizar al remitente del proyecto. El inicio de sesión de Nexus y las cuentas de los destinatarios quedan fuera de ese flujo.
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
  Y que MAIL_TRANSPORT no es "gmail-api", falta una credencial OAuth o GMAIL_SENDER no es una dirección gmail.com válida
  Cuando arranca la API
  Entonces el arranque falla con el código MAIL_CONFIG_INVALID
  Y el mensaje nombra la variable incorrecta sin mostrar valores ni credenciales

Escenario 2: Envío por HTTPS desde Render Free
  Dado que la API publicada usa MAIL_TRANSPORT="gmail-api"
  Cuando se envía un correo de verificación
  Entonces el transporte obtiene o reutiliza un token de acceso OAuth y envía el mensaje por HTTPS a la API de Gmail
  Y solo se marca el mensaje como enviado en la outbox después de que Google lo acepte
  Y si falla la conexión o la validación TLS, el mensaje queda pendiente para reintento

Escenario 3: Configuración verificada
  Dado que las credenciales OAuth autorizan el envío desde la cuenta Gmail del proyecto
  Cuando se ejecuta "npm run mail:check -- --to <buzón real>"
  Entonces el script envía un correo de prueba con el transporte de Gmail
  Y muestra el identificador que devuelve la API de Gmail
  Y termina con código 0

Escenario 4: Credenciales incorrectas
  Dado que el token de renovación OAuth es inválido o fue revocado
  Cuando se ejecuta "npm run mail:check -- --to <buzón real>"
  Entonces el script indica un error de autenticación sin mostrar credenciales
  Y no envía el correo de prueba
  Y termina con código 2

Escenario 5: Autenticidad comprobada en el buzón
  Dado el correo de prueba recibido en un buzón real
  Cuando se revisa su encabezado Authentication-Results
  Entonces aparecen spf=pass, dkim=pass y dmarc=pass
  Y la dirección del remitente coincide con GMAIL_SENDER
  (Verificación manual. La captura del encabezado va en el PR.)

Escenario 6: Dominio del destinatario sin correo
  Dado un alta con un correo cuyo dominio no tiene registros MX, A ni AAAA
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
  Entonces los logs del envío y la salida de mail:check omiten credenciales, tokens OAuth, contenido y enlaces de verificación

Escenario 13: Límite diario de Gmail
  Dado que la cuenta alcanzó el límite diario de envíos de Gmail
  Cuando se intenta enviar un correo de verificación
  Entonces el envío falla y el mensaje queda en iam.email_outbox para reintento
  Y no se pierde la operación de origen (registro, recuperación o invitación)

Escenario 14: Correo local en Mailpit
  Dado un entorno de desarrollo con Mailpit y sin credenciales OAuth
  Cuando Nexus envía un correo de verificación
  Entonces el mensaje llega a Mailpit por SMTP local
```

---

## 5. Contrato de API

No se agregan rutas. Cambia el error posible de dos rutas existentes:

| Ruta | Error nuevo | Causa |
|---|---|---|
| `POST /auth/register` | `400 EMAIL_DOMAIN_INVALID` | El dominio del correo carece de MX, A y AAAA, o su MX es nulo. |
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

- El remitente elegido es la cuenta dedicada `nexuscorreoprueba@gmail.com`. Un responsable del equipo habilita Gmail API en Google Cloud y autoriza esa cuenta una vez con OAuth 2.0 y acceso sin conexión (`access_type=offline`). El alcance `https://www.googleapis.com/auth/gmail.send` permite enviar correo. Los destinatarios reciben mensajes sin participar en la autorización. [Alcances de Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes) y [OAuth para aplicaciones de servidor](https://developers.google.com/identity/protocols/oauth2/web-server).
- Para el envío continuo, el equipo debe confirmar en Google Cloud que el cliente OAuth puede operar con el alcance sensible y completar la verificación si Google la exige. Un proyecto con audiencia externa y estado **Testing** emite tokens de renovación que caducan a los siete días para este alcance. Usar ese estado para pruebas y confirmar una configuración apta para uso continuo antes de activar producción. [Estado de publicación OAuth](https://support.google.com/cloud/answer/15549945) y [caducidad de tokens](https://developers.google.com/identity/protocols/oauth2#expiration).

### 8.2 Variables de entorno

| Variable | Ejemplo | Función |
|---|---|---|
| `MAIL_TRANSPORT` | `gmail-api` | Obligatorio en producción. En desarrollo el transporte predeterminado es el SMTP local de Mailpit. |
| `GMAIL_SENDER` | `nexuscorreoprueba@gmail.com` | Cuenta autorizada. Se usa para la ruta de Gmail y el encabezado `From`. |
| `GMAIL_CLIENT_ID` | Identificador del cliente OAuth | Cliente OAuth de Google Cloud que obtuvo el permiso. |
| `GMAIL_CLIENT_SECRET` | Secreto del cliente OAuth | Se guarda en los secretos de Render. |
| `GMAIL_REFRESH_TOKEN` | Token de renovación de la cuenta remitente | Se guarda en los secretos de Render. |
| `WEB_URL` | URL HTTPS de Nexus | Origen que se usa para los enlaces incluidos en los correos. |
| `IAM_CHECK_EMAIL_DOMAIN` | `true` | Activa la validación de dominio en registro y alta de miembros. `false` solo en pruebas. |

### 8.3 Configuración segura

- `infrastructure/mail-config.ts` valida el modo, la dirección remitente y la presencia de credenciales OAuth. `EmailService` llama a la validación al arrancar. La comprobación de credenciales contra Google se hace con `mail:check` y durante el envío.
- `infrastructure/mail-transport.ts` selecciona el transporte usado por `EmailService` y `mail:check`. Para Gmail, obtiene tokens de acceso en `https://oauth2.googleapis.com/token` mediante el token de renovación. Reutiliza el token de acceso en memoria hasta antes de su vencimiento y comparte la renovación entre envíos simultáneos del mismo proceso.
- El transporte compone MIME con Nodemailer, codifica el resultado en base64url y lo envía mediante `POST https://gmail.googleapis.com/gmail/v1/users/{userId}/messages/send`, con la dirección autorizada de `GMAIL_SENDER` como `userId` y `From`. Las peticiones tienen tiempo límite, validación TLS y destinos fijos de Google. El SMTP de Mailpit se conserva para desarrollo. [Método `users.messages.send`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).
- La outbox conserva la política actual de reintentos y expiración. Una respuesta `429`, un límite de cuota, un fallo de red o un fallo de autorización se registra con una categoría segura y deja el mensaje pendiente según esa política. Solo una respuesta satisfactoria de Gmail marca el mensaje como enviado. Una respuesta perdida después de que Gmail acepte el mensaje puede causar un duplicado al reintentar. [Errores de Gmail API](https://developers.google.com/workspace/gmail/api/guides/handle-errors).

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

1. Valida `--to` y aplica las reglas de producción de §8.3.
2. Usa el transporte de Gmail para obtener un token de acceso y enviar un correo de prueba al destinatario indicado. Si falla, imprime una categoría segura del error y termina con código `2`.
3. Si Gmail acepta el envío, imprime el identificador del mensaje, indica revisar `Authentication-Results` en el buzón recibido y termina con código `0`.

- **Códigos de salida:** `0` correcto, `2` configuración inválida, autenticación fallida o envío fallido.

### 8.6 Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Expira o se revoca la autorización OAuth. | Reautorizar la cuenta del proyecto, reemplazar el secreto en Render y ejecutar `mail:check`. |
| Google limita los envíos o el servicio no está disponible. | La outbox reintenta con espera creciente dentro de su plazo vigente. |
| Render Free suspende el servicio por inactividad. | Comprobar los reintentos con la instancia activa. La outbox los retoma cuando la API vuelve a arrancar, dentro del plazo de cada mensaje. [Suspensión de instancias Free](https://render.com/docs/free#spinning-down-on-idle). |
| Faltan variables al desplegar. | Cargar los secretos de Render y verificar el transporte antes de activar la revisión en el servicio publicado. |

---

## 9. Plan de Tareas (≤ 2 horas cada una)

- [ ] **T1 (equipo):** habilitar Gmail API, autorizar la cuenta del proyecto con el alcance `gmail.send` y guardar las credenciales OAuth en los secretos del entorno.
- [ ] **T2 (1.5 h):** implementar la validación de configuración, el transporte HTTPS con OAuth y la composición MIME. Probar el arranque y el transporte local.
- [ ] **T3 (1 h):** actualizar `mail:check`, simular errores de autenticación y probar el envío real desde el servicio Render Free.
- [ ] **T4 (1.5 h):** `EmailDomainChecker`, adaptador DNS con tiempo límite, `IamSettings.checkEmailDomain`, integración en registro y alta de miembros, y pruebas.
- [ ] **T5 (0.5 h):** actualizar `CONTRACTS.md`, el ADR-003, `.env.example`, `REGLAS.md` y la guía de instalación con la configuración aprobada.

**Archivos permitidos:** infraestructura de correo y DNS, configuración y servicios de registro y miembros en `apps/api/src/modules/iam/`, sus pruebas unitarias y de integración, `apps/api/src/scripts/mail-check.ts` y su prueba, `package.json` (script `mail:check`), los dos formularios de §7, `.env.example` y los documentos de §11. Los ajustes de configuración del instalador local se limitan a conservar el arranque local existente.

**Coordinación:** incorporar la versión de `main` que contiene SPEC-115 y SPEC-116 antes de implementar la revisión del transporte.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1 y 2 | Unitaria | Configuración, renovación y reutilización de credenciales, composición MIME y HTTPS con peticiones simuladas |
| Escenarios 3 y 4 | Unitaria | `mail-check.spec.ts` con éxito, credencial revocada y salida sin secretos |
| Escenario 5 | Manual | Captura de `Authentication-Results` en el PR |
| Escenarios 6 a 10 | Unitaria | `dns-email-domain-checker.spec.ts` (resolver simulado) e `iam.registration.spec.ts`, más las pruebas de alta de miembros |
| Escenario 11 | Unitaria | Prueba que confirma que el validador no se llama en recuperación ni reenvío |
| Escenario 12 | Unitaria | Captura de logs en las pruebas de envío y de `mail:check` |
| Escenario 13 | Unitaria | `iam.outbox.spec.ts` (existente): un error del proveedor deja el mensaje pendiente para reintento |
| Escenario 14 | Integración local | Correo recibido en Mailpit con la configuración de desarrollo |
| Envío real desde Render Free | Manual | Correo recibido en Gmail y Outlook, captura del encabezado de autenticación y verificación de una cuenta en la web publicada |

---

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md`, sección "Alcance final [v0.6]": código `EMAIL_DOMAIN_INVALID` en registro y alta de miembros.
- [ ] `docs/decisions/ADR-003-detalles-operativos-aprobados.md`: enmienda con la API de Gmail sobre HTTPS, el alcance de OAuth, la cuenta remitente y la regla de validación.
- [ ] `.env.example`: variables de Gmail, sin credenciales.
- [ ] `specs/README.md`: reflejar el título y estado de SPEC-117 en el catálogo.
- [ ] `docs/GUIA_INSTALACION_Y_EJECUCION.md`: documentar la autorización inicial, las variables en Render, la renovación de credenciales y la prueba real. Si se mantiene una copia externa del instructivo de despliegue, sustituir allí las instrucciones de Mailtrap o SMTP.
- [ ] `REGLAS.md`: documentar Mailpit para desarrollo y la API de Gmail por HTTPS para producción.

---

## 12. Preguntas Abiertas

1. **Transporte:** API de Gmail por HTTPS. La API publicada usa Render Free, que bloquea SMTP en los puertos previstos en la revisión anterior.
2. **Dominio. Resuelto:** no hay dominio propio. Se usa la cuenta de Gmail.
3. **Resuelto:** no desplegar con Mailpit. La guarda de §8.3 se mantiene.
4. **Resuelto:** si la consulta DNS falla, se deja pasar el registro (`unknown`) y se escribe una advertencia.
5. **Resuelto:** cualquier correo válido puede usarse. No se limita al dominio de la organización.
6. **Resuelto:** el nombre genérico de validación es `VALIDATION_ERROR`, como en `CONTRACTS.md`. SPEC-116 debe corregirse, porque hoy usa `VALIDATION_FAILED`.
7. **Cuenta remitente acordada:** `nexuscorreoprueba@gmail.com`. Está pendiente validar la configuración OAuth en Google Cloud para envío continuo (§8.1).

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-10 | Claude Code (borrador) | Versión inicial. Hosts SMTP de Brevo verificados en su documentación pública. |
| 2026-11-10 | Claude Code (borrador) | Proveedor decidido: Brevo. Resend descartado. |
| 2026-11-10 | Claude Code (borrador) | Decididos: no desplegar con Mailpit (punto 3), fallo DNS deja pasar (punto 4), sin restricción por dominio (punto 5), `VALIDATION_ERROR` (punto 6). |
| 2026-11-10 | Claude Code (borrador) | Cambio a Gmail SMTP: sin dominio propio, Brevo y Resend quedan descartados. Se reescriben §1, §2, §3, §4 (criterios 1 a 5), §8.1 a §8.6 y §9. Se agrega el criterio 13 (límite diario). Pendiente: elegir la cuenta de Gmail (§8.1). |
| 2026-11-10 | Víctor Chán Morales | Aprobada. La cuenta de Gmail se elige antes de T1 (§8.1, pregunta 7). |
| 2026-11-10 | Revisión propuesta | Render Free bloquea SMTP. Se propone la API de Gmail por HTTPS y se registra la cuenta remitente acordada. |
