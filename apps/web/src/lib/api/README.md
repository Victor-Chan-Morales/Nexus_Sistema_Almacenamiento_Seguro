# Clientes de Nexus API

La base HTTP compartida y los clientes tipados implementan las rutas del contrato aprobado en `CONTRACTS.md`:

- `client.ts`: transporte JSON/blob, inclusión de cookies, bearer token explícito y normalización de errores.
- `iam.ts`: registro, login y usuario actual.
- `billing.ts`: catálogo y activación simulada de suscripción.
- `dashboard.ts`: resumen del espacio de trabajo.
- `files.ts`: listado/creación de carpetas, elementos, carga y descarga.

## Uso

Configura `NEXT_PUBLIC_API_BASE_URL` en `.env.local` (por ejemplo, `http://localhost:3001`). Cada cliente devuelve una promesa tipada y lanza `ApiError` en errores HTTP, de red o de configuración. El bearer token se pasa a la operación que lo necesita y permanece a cargo del estado de sesión en memoria; el cliente no lo almacena. Todas las solicitudes incluyen cookies para la sesión/refresh `HttpOnly` definida por IAM.

Para desarrollo entre puertos distintos, el API debe permitir el origen exacto de la aplicación con credenciales CORS (no `Access-Control-Allow-Origin: *`) y exponer `Content-Disposition` para que el navegador pueda leer el nombre de descarga.

```ts
import { login, getCurrentUser } from "@/lib/api/iam";

const session = await login({ email, password });
const currentUser = await getCurrentUser(session.accessToken);
```

Los endpoints de verificación de correo y recuperación de contraseña aún no forman parte del contrato v0.2; no se crean rutas API especulativas aquí. Los esquemas de `plan`/`recentActivity` del dashboard y el detalle de archivos listados también deben concretarse con los responsables de dominio antes de refinar esos tipos.

Los datos de maqueta siguen en `demo.ts` y `billing-demo.ts`; estos clientes no crean respuestas simuladas ni se conectan automáticamente a las pantallas.
