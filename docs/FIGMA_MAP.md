# Mapa de mockups a rutas y contratos

**Estado:** se recibió el enlace del archivo Figma; la comparación visual y la validación de rutas aún están pendientes. Este mapa no sustituye la revisión de cada frame. La paleta y la tipografía Inter están documentadas en `docs/IDENTIDAD_VISUAL.md`.

| ID y nombre del frame | Ruta propuesta | Responsable de frontend | Dominio API | Frame revisado | Campos / acciones confirmados | Estado |
|---|---|---|---|---|---|---|
| [Landing de servicios y acceso al registro — nodo 107-10592](https://www.figma.com/design/rgO3iIMUvvWDyl6GQa6umF/ProyectoIngenieriaSoftware?node-id=107-10592&t=AjEQaNl10oWRPfdD-1) | `/` (confirmar ruta) | Víctor | Billing / registro | No | Presenta los servicios y permite continuar a crear una cuenta, según Víctor | Enlace recibido; revisión pendiente |
| Pendiente: inicio de sesión | `/login` | Víctor | IAM — Sebastián | No | Pendiente | Estructura de ruta |
| Pendiente: registro | `/registro` | Víctor | IAM — Sebastián | No | Pendiente | Estructura de ruta |
| Pendiente: planes/contratación | `/planes` | Víctor | Billing — Anthony | No | Pendiente | Estructura de ruta |
| Pendiente: dashboard | `/dashboard` | Víctor | IAM/Billing/Files | No | Pendiente | Estructura de ruta |
| Pendiente: explorador de archivos | `/archivos` | Víctor | Files/Storage — Miguel | No | Pendiente | Estructura de ruta |

## Cómo completar cada fila

Anoten el nombre/ID exacto del frame, enlace navegable, captura aprobada, campos (tipo/obligatorio), botones, resultado/estado, ruta web, endpoints y responsable. Marquen “revisado” solo después de comparar la implementación con Figma. En la landing, confirmar si la acción de contratación deriva a planes o inicia directamente el registro.

## Checklist por pantalla

- [ ] Se puede encontrar el frame en el archivo compartido.
- [ ] Texto, títulos, jerarquía, color, medidas y controles coinciden.
- [ ] La paleta corresponde a `docs/IDENTIDAD_VISUAL.md`; Inter se aplica consistentemente y la geometría final se valida en el frame.
- [ ] Se identificaron estado inicial, carga, vacío, error y éxito que aparezcan en Figma.
- [ ] Cada botón tiene comportamiento contratado o está claramente marcado como pendiente.
- [ ] No se agregaron datos de plan, nombres o límites de ejemplo como si fueran reales.
