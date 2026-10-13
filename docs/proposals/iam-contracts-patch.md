# Cambios propuestos a CONTRACTS.md (IAM)

Estado: **PROPUESTO — requiere aprobación de Víctor (consumidor) antes de mergear las rutas nuevas.**
Si no se aprueba, `verify-email`, `refresh` y `logout` quedan bloqueadas por contrato.

## 1. Fila modificada — `POST /auth/login`
Sin cambios respecto de v0.2: `{ accessToken, expiresAt, user: { id, fullName, email }, organization: { id, name }, role }`.
`expiresAt` en ISO-8601 UTC (15 min). El refresh token solo viaja en cookie.

## 2. Filas nuevas en "Recorrido de 30%"
| Módulo | Método y ruta | Entrada propuesta | Salida propuesta | Propietario API |
|---|---|---|---|---|
| IAM | POST /auth/verify-email | `{ token }` | `{ verified: true }` | Sebastián |
| IAM | POST /auth/refresh | Cookie `nexus_rt` | Igual que login; rota la cookie | Sebastián |
| IAM | POST /auth/logout | Cookie `nexus_rt` | 204 sin cuerpo | Sebastián |

## 3. Decisiones operativas (agregar)
- La cookie `nexus_rt` es HttpOnly, `Path=/api/auth`, 7 días, `SameSite=Lax` por defecto, `Secure` en producción. El navegador debe usar `credentials: 'include'`; CORS con origen explícito y `credentials: true`.
- El login **exige correo verificado** (`403 EMAIL_NOT_VERIFIED` tras credenciales correctas). Configurable con `IAM_REQUIRE_VERIFIED_EMAIL`; la pantalla debe aplicar el mismo comportamiento.
- Reutilizar un refresh token ya rotado revoca todas las sesiones del usuario.
- Códigos de error de IAM: ver tabla en `docs/modules/IAM.md` (se mantiene el formato común `{ code, message, requestId }`).

## 4. Tipos para `apps/web/src/lib/api/types.ts` (los mantiene Víctor)
```ts
export interface RegisterResponse { userId: string; organizationId: string; role: string; verificationRequired: boolean }
export interface LoginResponse {
  accessToken: string; expiresAt: string;
  user: { id: string; fullName: string; email: string };
  organization: { id: string; name: string };
  role: string;
}
export interface MeResponse { user: LoginResponse['user']; organization: LoginResponse['organization']; role: string }
export interface ApiError { code: string; message: string; requestId: string }
```
Tipos de compilación; no validan datos en tiempo de ejecución.

## 5. Sigue fuera de este contrato
Recuperación de contraseña, reenvío de verificación y RBAC completo (el contrato v0.2 ya los marca como no implementados). MFA/TOTP fuera de alcance.
