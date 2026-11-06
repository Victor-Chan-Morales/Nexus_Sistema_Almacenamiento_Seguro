# Evidencia SPEC-804: pantalla de almacenamiento y segundo S3

Verificación ejecutada sobre la API compilada (`apps/api/dist/main.js`, con `DESTINATION_ALLOW_PRIVATE=true`), la web en modo desarrollo (`npm run dev:web`), PostgreSQL de desarrollo y los dos almacenes S3: el de entorno y el del perfil `s3-local` (`docker compose --profile s3-local up -d`, bucket `nexus-local`, puerto 8334). Capturas en esta carpeta; no contienen credenciales ni endpoints.

## Lo que se comprobó

Con Chromium headless (Playwright, en local) contra la web y la API reales:

| Escenario | Comprobación | Resultado |
|---|---|---|
| 1 Modelos | `/almacenamiento` como administrador: Nube, Servidor local y Híbrido, con el modelo actual marcado "Actual" | Correcto (`almacenamiento-admin.png`) |
| 2 Destinos | Tabla de destinos con nombre, ubicación, proveedor, estado y predeterminado; el destino de Servidor local queda "Conectado" | Correcto. Sin endpoint, bucket ni credenciales en pantalla |
| 3 Cambio de modelo | Diálogo al elegir Nube desde Híbrido: aviso "Los archivos que ya están guardados no se mueven", selector de predeterminado y ausencia del término técnico `on_premises` | Correcto (`dialogo-cambio-modelo.png`). No se confirmó el cambio en la interfaz |
| 4 Carpeta principal en híbrido | Crear carpeta en la raíz muestra "¿Dónde se guardará?" con las opciones "Almacenamiento Nexus · Nube" y "Servidor local E8 · Servidor local"; "Crear carpeta" deshabilitado hasta elegir | Correcto (`crear-carpeta-hibrido.png`) |
| 5 Etiqueta de ubicación | La lista del explorador muestra "Nube" o "Servidor local" en cada carpeta | Correcto (`archivos-admin.png`) |
| 6 Colaborador | Sesión de colaborador: la nota "Solo un administrador puede cambiarlo" aparece; no hay botones de registro ni de prueba; la red solo llama a `GET /organizations/storage-policy` | Correcto (`almacenamiento-colaborador.png`). Sin llamadas a `/destinations` ni a solicitudes |
| 8 Segundo almacén | `docker compose --profile s3-local up -d` levanta `nexus-seaweedfs-local-dev` en 8334 y sin el perfil no arranca | Correcto (verificado con `docker compose config --services`) |

Los escenarios 1 a 8 de la API ya se comprobaron en SPEC-803 (`docs/evidencia/spec-803/RESUMEN.md`). Aquí se comprueba la pantalla encima de esa API.

Adicionalmente: 0 errores de consola en `/almacenamiento` y `/archivos` como administrador. El único error 401 corresponde a la llamada de refresco de sesión en `/login` antes de autenticarse.

## Lo que no se comprobó y por qué

- **Escenario 2 (registro y prueba de un destino desde la pantalla)**: el formulario y el botón "Probar conexión" tienen código y build correctos, pero no se recorrieron con clics en el navegador. La API del mismo flujo sí se probó en SPEC-802 y SPEC-803.
- **Escenario 7 (solicitud desde la pantalla)**: la solicitud ya existía en la base y se ve en la lista, pero no se envió una nueva desde la interfaz.
- **Crear subcarpeta**: no se comprobó que el selector no aparezca dentro de una subcarpeta en modelo híbrido; el código lo condiciona a la raíz del Drive.
- **Guía con AWS CLI**: el bucket del segundo almacén se creó con el SDK de S3 usado por la API. El comando de AWS CLI de la guía no se ejecutó.
- **Cuadrícula de carpetas**: el explorador de esta versión solo tiene vista de lista; no hay vista de cuadrícula que comprobar.

## Desviaciones y notas

- **Dirección del segundo almacén**: la spec §8 indicaba `localhost:8334`, que SPEC-802 bloquea siempre. La guía y la verificación usan la IP de la LAN o el nombre del servicio.
- **Estilo**: las tarjetas de la pantalla de almacenamiento dejan un espacio vacío encima de cada título. Es un defecto visual menor y queda pendiente de revisión con el cotejo de diseño.
- **Ajuste de comportamiento**: el selector del explorador deshabilita "Crear carpeta" hasta elegir un destino; el servidor sigue siendo quien valida la regla.
