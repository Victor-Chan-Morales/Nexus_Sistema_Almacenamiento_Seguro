# SPEC-105: FRONTEND DE RECUPERACIÓN DE CONTRASEÑA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (Frontend / Integración) |
| **Responsable Principal** | Miguel (delegado por Víctor, ver `docs/equipo/asignaciones.md`) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/auth-forms.tsx`, `apps/web/src/lib/api/iam.ts` y las rutas `recuperar-contrasena` y `nueva-contrasena` |
| **Requisitos Vinculados** | Curso §4.1 |
| **Dependencias** | SPEC-103 (API). Puede avanzar con un mock del contrato v0.5. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 1.5 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

Conectar `RecoverForm` y `NewPasswordForm` con `POST /auth/forgot-password` y `POST /auth/reset-password`, y eliminar las marcas de "prototipo" y el enlace "Abrir nueva contraseña (demo)".

---

## 3. Fuera de Alcance (YAGNI)

- Cambiar la contraseña desde el perfil con sesión iniciada.
- Medidor de fortaleza de contraseña: la política la valida la API.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Solicitud
  Dado que la persona escribe su correo en /recuperar-contrasena y envía
  Cuando la API responde 200
  Entonces la pantalla muestra el mensaje genérico recibido ("Si el correo está registrado...")
  Y el botón queda deshabilitado durante la petición y 30 s después
  Y no aparece enlace "demo" ni leyenda de prototipo

Escenario 2: Restablecimiento
  Dado que abre /nueva-contrasena?token=XYZ y escribe una contraseña y su confirmación iguales
  Cuando la API responde 200
  Entonces muestra el éxito y redirige a /login a los 2 segundos

Escenario 3: Token inválido o vencido
  Cuando la API responde 400 INVALID_OR_EXPIRED_TOKEN
  Entonces muestra "El enlace venció o ya se usó" con un botón "Solicitar otro enlace"

Escenario 4: Sin token en la URL
  Entonces muestra el estado de enlace inválido sin llamar a la API

Escenario 5: Estados de interfaz
  Entonces existen cargando, error (con reintento) y éxito en ambas pantallas
```

---

## 5. Contrato de API

Consume `CONTRACTS.md` v0.5, "Recuperación de contraseña". Tipos en `lib/api/types.ts`; funciones `forgotPassword(email)` y `resetPassword(token, newPassword)` en `lib/api/iam.ts` (no se crea `auth.ts`).

---

## 6. Datos y Esquema

No aplica.

---

## 7. Interfaz de Usuario

- Rutas: `/recuperar-contrasena` y `/nueva-contrasena` (existen).
- Mensajes en español; errores de la API mapeados por `code`, nunca se muestra texto del servidor desconocido.
- Estados: cargando, éxito, error con reintento, enlace inválido.

---

## 8. Diseño Técnico

- La confirmación de contraseña se compara en el cliente solo como ayuda de captura; la política real la valida la API.
- El token se lee de `useSearchParams()` y no se guarda ni se registra en consola.

---

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: `forgotPassword` y `resetPassword` en `lib/api/iam.ts` y tipos.
- [ ] **T2 (35 min)**: conectar `RecoverForm` (estados, bloqueo de 30 s, quitar `simulated`).
- [ ] **T3 (35 min)**: conectar `NewPasswordForm` (token, confirmación, token inválido, redirección).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Verificación |
|---|---|---|
| Escenarios 1–5 | Manual contra Mailpit (`localhost:8025`) | Recorrido: solicitar → abrir el correo → restablecer → iniciar sesión |

---

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`: marcar las pantallas como conectadas.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Funciones en `lib/api/iam.ts` (no existe `auth.ts`); retirado el enlace demo; estados y token inválido. |
