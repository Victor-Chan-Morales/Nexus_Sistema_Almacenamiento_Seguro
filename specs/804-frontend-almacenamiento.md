# SPEC-804: PANTALLA DE ALMACENAMIENTO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (toca `docker-compose.yml`, zona protegida por la regla 4) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/app/almacenamiento/`, `apps/web/src/components/`, `docker-compose.yml` |
| **Requisitos Vinculados** | RF-014 |
| **Dependencias** | SPEC-803 |
| **Prioridad** | P1 |
| **Estimación** | 2 h |
| **Estado** | Implementada (2026-11-06, `feat/804-frontend-almacenamiento`). Aprobada el 2026-11-04 por Víctor Chán Morales |

## 2. Objetivo

Elegir Nube, Local o Híbrido, administrar destinos y solicitar instalación; y un segundo contenedor S3 para comprobar el modelo híbrido en desarrollo.

## 3. Fuera de Alcance

- Mover archivos entre destinos.
- Cambios en la API.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Modelos
  Dado un tenant_admin en /almacenamiento
  Entonces ve Nube, Local e Híbrido explicados en lenguaje sencillo, con el actual marcado

Escenario 2: Destinos
  Entonces puede registrar un destino, ver su estado y pulsar "Probar conexión"
  Y los campos de clave secreta nunca muestran el valor guardado

Escenario 3: Cambio de modelo
  Cuando elige otro modelo
  Entonces un diálogo avisa que los archivos existentes no se mueven
  Y si faltan requisitos, se explica qué destino hace falta

Escenario 4: Crear carpeta principal en híbrido
  Dado un modelo hybrid
  Cuando crea una carpeta en la raíz
  Entonces debe elegir Nube o Local
  Y en subcarpetas no aparece el selector

Escenario 5: Ver ubicación
  Entonces el explorador muestra una etiqueta Nube o Local en cada carpeta

Escenario 6: Colaborador
  Dado un colaborador
  Entonces ve el modelo actual en modo lectura, sin credenciales ni acciones

Escenario 7: Solicitar instalación
  Cuando solicita instalación
  Entonces ve el estado de su solicitud

Escenario 8: Segundo almacén
  Cuando ejecuta docker compose --profile s3-local up -d
  Entonces existe un segundo S3 que se puede registrar como destino on_premises
```

## 5. Contrato de API

Consume SPEC-802 y SPEC-803.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

- **Ruta nueva:** `/almacenamiento`, con un elemento en `app-shell.tsx`.
- **Estados:** cargando, vacío, error, datos, y "Comprobando…" al probar.
- Terminología: "Nube" y "Servidor local", nunca `on_premises`.

## 8. Diseño Técnico

- `lib/api/storage.ts` (nuevo).
- `docker-compose.yml`: servicio `seaweedfs-local` con perfil `s3-local`, otro volumen y puerto 8334. No altera los perfiles existentes.
- Dentro de Docker se alcanza por nombre de servicio (`seaweedfs-local:8333`). Desde la API en el equipo se registra con la IP de la LAN y `localhost:8334` **no** sirve: SPEC-802 bloquea loopback siempre, con o sin `DESTINATION_ALLOW_PRIVATE=true` (corrección de la versión aprobada, ver §13).
- Dividir en `components/storage-settings.tsx` y `components/destination-form.tsx`.

## 9. Plan de Tareas

- [x] **T1 (15 min)**: Cliente y tipos (`746a42c`).
- [x] **T2 (50 min)**: Pantalla y formulario (`746a42c`).
- [x] **T3 (25 min)**: Selector y etiqueta en el explorador (`c8f00e0`).
- [x] **T4 (30 min)**: Servicio en Compose y prueba manual completa (`c1ad403`). Evidencia en `docs/evidencia/spec-804/RESUMEN.md`.

**Archivos permitidos:** `app/almacenamiento/page.tsx`, `components/storage-settings.tsx`, `components/destination-form.tsx`, `lib/api/storage.ts` (nuevos), `components/file-browser-live.tsx`, `components/app-shell.tsx`, `lib/api/types.ts`, `app/globals.css`, `docker-compose.yml`, `.env.example`, `docs/GUIA_INSTALACION_Y_EJECUCION.md`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–8 | Manual con dos contenedores; `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

- [x] `docs/GUIA_INSTALACION_Y_EJECUCION.md`, `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-06 | Claude Code | Implementada en `feat/804-frontend-almacenamiento` (`746a42c`, `c8f00e0`, `c1ad403`). **Corrección de §8:** el destino de la API en el equipo se registra con la IP de la LAN, no con `localhost:8334`, porque SPEC-802 bloquea loopback (la evidencia de SPEC-802, E8, lo confirma con 422). **Desviaciones de archivos permitidos:** `lib/storage-labels.ts`, `components/storage-model-picker.tsx`, `components/destination-list.tsx`, `components/installation-request-panel.tsx` (subcomponentes de la pantalla), `lib/api/README.md` (lista de clientes, regla 11) y `docs/evidencia/spec-804/`. **Pendiente:** cotejo visual con diseño (espacio vacío sobre los títulos de las tarjetas), y los escenarios 2 (registro y prueba desde la interfaz) y 7 (nueva solicitud desde la interfaz) sin recorrer con clics; ver la evidencia. |
