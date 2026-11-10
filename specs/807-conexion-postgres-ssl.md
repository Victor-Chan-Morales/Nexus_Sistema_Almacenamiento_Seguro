# SPEC-807: CONEXIÓN A POSTGRESQL CON SSL Y PUERTO DE LA PLATAFORMA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (Configuración de conexión a la base de datos: zona sensible) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/config/` (nuevo), `.env.example` |
| **Requisitos Vinculados** | RNF-002 (TLS), RNF-010 (despliegue portable) |
| **Dependencias** | Ninguna |
| **Prioridad** | P1 |
| **Estimación** | 1.5 h |
| **Hito Objetivo** | Despliegue público (10-Nov-2026) |
| **Estado** | Borrador |

---

## 2. Objetivo

Permitir que la API se conecte a una base de PostgreSQL que exige SSL, como la URL externa de Render, y que escuche en el puerto que asigna la plataforma (`PORT`). Sin esto, `npm run seed:super-admin` no puede ejecutarse desde otra computadora contra la base de Render, y la API en Render exige una variable manual (`API_PORT`) para arrancar.

---

## 3. Fuera de Alcance (YAGNI)

- No se cambian las migraciones. dbmate ya acepta `sslmode` en `DATABASE_URL`, como indica el instructivo (A.4).
- No se configura SSL en Docker Compose local: el valor por defecto es `false`.
- No se gestionan certificados del servidor de PostgreSQL ni cifrado en reposo.
- No se añaden variables específicas de otros proveedores (Neon, Supabase).
- No se cambia la forma de leer `API_PORT` cuando está definido.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Sin SSL por defecto
  Dado que POSTGRES_SSL no está definida
  Cuando la API abre su conexión con PostgreSQL
  Entonces la conexión no usa SSL, igual que hoy

Escenario 2: SSL con verificación del certificado del sistema
  Dado que POSTGRES_SSL=true y POSTGRES_SSL_CA no está definida
  Cuando la API abre su conexión con PostgreSQL
  Entonces la conexión usa TLS y verifica el certificado con las autoridades del sistema
  Y una conexión con un certificado no válido se rechaza

Escenario 3: SSL con autoridad propia
  Dado que POSTGRES_SSL=true y POSTGRES_SSL_CA apunta a un archivo PEM legible
  Cuando la API abre su conexión con PostgreSQL
  Entonces la conexión usa TLS y verifica el certificado con esa autoridad

Escenario 4: Archivo de autoridad inexistente
  Dado que POSTGRES_SSL_CA apunta a un archivo que no existe
  Cuando la API arranca
  Entonces el proceso termina con un error que nombra la variable POSTGRES_SSL_CA
  Y el error no muestra el contenido del archivo ni la contraseña de la base

Escenario 5: Valor inválido de POSTGRES_SSL
  Dado que POSTGRES_SSL=yes
  Cuando la API arranca
  Entonces el proceso termina con el error "POSTGRES_SSL debe ser true o false"

Escenario 6: Puerto de la plataforma
  Dado que API_PORT no está definida y PORT=10000
  Cuando la API arranca
  Entonces escucha en el puerto 10000

Escenario 7: API_PORT tiene prioridad
  Dado que API_PORT=3001 y PORT=10000
  Cuando la API arranca
  Entonces escucha en el puerto 3001

Escenario 8: Valor por defecto del puerto
  Dado que ni API_PORT ni PORT están definidas
  Cuando la API arranca
  Entonces escucha en el puerto 3001

Escenario 9: Puerto inválido
  Dado que PORT=abc
  Cuando la API arranca
  Entonces el proceso termina con el error "El puerto debe ser un número entre 1 y 65535"

Escenario 10: Semilla del Super Admin contra la base externa
  Dado que POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD y POSTGRES_DB apuntan a la base externa de Render, con POSTGRES_SSL=true
  Cuando se ejecuta npm run seed:super-admin
  Entonces la cuenta del Super Admin se crea y el comando termina sin error
```

---

## 5. Contrato de API

Sin rutas. Cambio de configuración por variables de entorno.

| Variable | Valores | Por defecto | Efecto |
|---|---|---|---|
| `POSTGRES_SSL` | `true` / `false` | `false` | `true` activa TLS en la conexión a PostgreSQL. Cualquier otro valor impide el arranque. |
| `POSTGRES_SSL_CA` | Ruta a un archivo PEM | Vacía | Si se define, el certificado se verifica con esa autoridad. Solo aplica con `POSTGRES_SSL=true`. |
| `API_PORT` | Número de 1 a 65535 | Vacía | Puerto de escucha. Tiene prioridad sobre `PORT`. |
| `PORT` | Número de 1 a 65535 | Vacía | Lo asigna la plataforma (Render). Se usa si `API_PORT` no está definida. |

**Orden de resolución del puerto:** `API_PORT`, luego `PORT`, luego `3001`.

**Errores de arranque** (no son respuestas HTTP): el proceso termina con un mensaje que nombra la variable. No muestra valores de secretos.

---

## 6. Datos y Esquema

- **¿Modifica el esquema de base de datos?**: No.
- **Tablas afectadas**: ninguna.

---

## 7. Interfaz de Usuario (UI/UX)

No aplica.

---

## 8. Diseño Técnico (Obligatorio para N2)

### Firmas

```typescript
// apps/api/src/config/postgres-config.ts (nuevo)
export interface PostgresSslOptions {
  rejectUnauthorized: true;
  ca?: string;
}

/** Función pura: recibe lectores de variables y de archivos para poder probarla sin entorno real. */
export function buildPostgresSsl(
  get: (key: string) => string | undefined,
  readFile: (path: string) => string,
): false | PostgresSslOptions;

// apps/api/src/config/api-port.ts (nuevo)
/** Función pura: API_PORT, luego PORT, luego 3001. Lanza error si el valor no es un puerto válido. */
export function resolveApiPort(get: (key: string) => string | undefined): number;
```

### Cambios de cableado

- `app.module.ts`: en la opción `TypeOrmModule.forRootAsync`, añadir `ssl: buildPostgresSsl(key => config.get(key), path => fs.readFileSync(path, 'utf8'))`.
- `main.ts`: sustituir `const port = process.env.API_PORT ?? 3001;` por `const port = resolveApiPort(key => process.env[key]);`.
- Los scripts de datos iniciales (`seed:super-admin`) arrancan `AppModule`, así que heredan la configuración sin cambios adicionales. Se verifica en el escenario 10.

### Comportamiento de `buildPostgresSsl`

| `POSTGRES_SSL` | `POSTGRES_SSL_CA` | Resultado |
|---|---|---|
| No definida o `false` | Cualquiera | `false` (sin SSL) |
| `true` | No definida | `{ rejectUnauthorized: true }` |
| `true` | Ruta válida | `{ rejectUnauthorized: true, ca: <contenido del archivo> }` |
| `true` | Ruta inexistente o ilegible | Error al arrancar, sin contenido del archivo |
| Otro valor | Cualquiera | Error al arrancar: "POSTGRES_SSL debe ser true o false" |

El archivo de autoridad se lee una sola vez, al arrancar.

### Transaccionalidad

No aplica.

### Auditoría

No aplica.

### Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El certificado de Render no está en las autoridades del sistema | Se usa `POSTGRES_SSL_CA` con la autoridad que entregue Render. Ver pregunta en el chat antes de aprobar. |
| Un error de SSL deja la API sin arrancar | Se documenta en `.env.example` y en la guía. El mensaje de error nombra la variable. |
| Se filtra la contraseña de la base en los logs | Ningún mensaje de error ni de arranque incluye la contraseña ni el contenido de la autoridad. |
| `API_PORT` y `PORT` distintos | Gana `API_PORT`, como indica la sección 5. |

---

## 9. Plan de Tareas (≤ 2 horas cada una)

- [ ] **Tarea 1 (Configuración SSL)**: crear `buildPostgresSsl` con sus casos de prueba (30 min).
  *Archivos:* `apps/api/src/config/postgres-config.ts` (nuevo), `apps/api/src/config/postgres-config.spec.ts` (nuevo).
- [ ] **Tarea 2 (Puerto)**: crear `resolveApiPort` con sus casos de prueba (20 min).
  *Archivos:* `apps/api/src/config/api-port.ts` (nuevo), `apps/api/src/config/api-port.spec.ts` (nuevo).
- [ ] **Tarea 3 (Cableado y documentación)**: conectar ambas funciones en `app.module.ts` y `main.ts`; añadir `POSTGRES_SSL=false` y `POSTGRES_SSL_CA=` a `.env.example` (20 min).
  *Archivos:* `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `.env.example`.
- [ ] **Tarea 4 (Verificación)**: `npm run build:api`, `npm run test:api -- config`, y prueba real de los escenarios 6 y 10 contra Render (30 min).
  *Archivos:* ninguno. Resultado en `SESSION_LOG.md`.

---

## 10. Estrategia de Pruebas

| Criterio de Aceptación | Tipo de Prueba | Archivo de Prueba |
|---|---|---|
| Escenarios 1 a 5 | Unitaria | `apps/api/src/config/postgres-config.spec.ts` |
| Escenarios 6 a 9 | Unitaria | `apps/api/src/config/api-port.spec.ts` |
| Escenario 10 (semilla contra Render) | Manual | Registro en `SESSION_LOG.md` |
| Regresión del arranque local sin SSL | Manual | `npm run dev:api` con `.env` de `.env.example` |

---

## 11. Impacto en Documentación

- [ ] `.env.example`: variables `POSTGRES_SSL` y `POSTGRES_SSL_CA`, y nota sobre la prioridad de `API_PORT` y `PORT`.
- [ ] `docs/GUIA_INSTALACION_Y_EJECUCION.md`: sección de despliegue con las dos variables.
- [ ] `specs/README.md`: marcar SPEC-807 como implementada cuando se fusione.

---

## 12. Preguntas Abiertas

Ninguna. Valor confirmado por Víctor: verificación con las autoridades del sistema por defecto; `POSTGRES_SSL_CA` queda como opción si Render entrega una CA propia.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-09 | Revisión de coordinación | Versión inicial en borrador a partir del estado de `origin/main` (`58be6a5`). |
