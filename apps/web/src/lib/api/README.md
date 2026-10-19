# Clientes de Nexus API

La base HTTP compartida y los clientes tipados implementan las rutas del contrato aprobado en `CONTRACTS.md`:

- `client.ts`: transporte JSON/blob, inclusión de cookies, bearer token explícito y normalización de errores.
- `types.ts`: DTO compartidos para solicitudes y respuestas de los cuatro dominios.
- `iam.ts`: registro, login y usuario actual.
- `billing.ts`: catálogo y activación simulada de suscripción.
- `dashboard.ts`: resumen del espacio de trabajo.
- `files.ts`: listado/creación de carpetas, elementos, carga y descarga.

## Uso

Configura `NEXT_PUBLIC_API_BASE_URL` en `.env.local` (por ejemplo, `http://localhost:3001/api`). Cada cliente devuelve una promesa tipada y lanza `ApiError` en errores HTTP, de red o de configuración. El bearer token se pasa a la operación que lo necesita y permanece a cargo del estado de sesión en memoria; el cliente no lo almacena. Todas las solicitudes incluyen cookies para la sesión/refresh `HttpOnly` definida por IAM.

Para desarrollo entre puertos distintos, el API debe permitir el origen exacto de la aplicación con credenciales CORS (no `Access-Control-Allow-Origin: *`) y exponer `Content-Disposition` para que el navegador pueda leer el nombre de descarga.

```ts
import { login, getCurrentUser } from "@/lib/api/iam";

const session = await login({ email, password });
const currentUser = await getCurrentUser(session.accessToken);
```

El contrato v0.3 de `CONTRACTS.md` incluye verificación de correo, refresh/logout, el esquema de Dashboard y el detalle de archivos. Recuperación de contraseña queda fuera de este corte; no agregues rutas para ella hasta que se aprueben en una versión posterior.

Los datos de maqueta siguen en `demo.ts` y `billing-demo.ts` para prototipos que aún no se migran. Las rutas `/dashboard` y `/archivos` usan los clientes API; sus respuestas no deben mezclarse con los datos locales de maqueta.
