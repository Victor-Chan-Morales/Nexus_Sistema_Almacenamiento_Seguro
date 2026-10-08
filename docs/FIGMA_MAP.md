# Mapa de mockups a rutas y contratos

**Estado:** se recibió el enlace del archivo Figma; la comparación visual y la validación de rutas aún están pendientes. Este mapa no sustituye la revisión de cada frame. La paleta y la tipografía Inter están documentadas en `docs/IDENTIDAD_VISUAL.md`.

| ID y nombre del frame | Ruta propuesta | Responsable de frontend | Dominio API | Frame revisado | Campos / acciones confirmados | Estado |
|---|---|---|---|---|---|---|
| [Landing de servicios y acceso al registro — nodo 107-10592](https://www.figma.com/design/rgO3iIMUvvWDyl6GQa6umF/ProyectoIngenieriaSoftware?node-id=107-10592&t=AjEQaNl10oWRPfdD-1), `docs/figma/landing/mk_Principal.png` | `/` | Víctor | Billing / registro | Frame y captura revisados; cotejo final pendiente | Presentación de Nexus, beneficios, almacenamiento, seguridad, planes y accesos a registro/login | Implementación inicial; falta cotejo visual final |
| `docs/figma/landing/mk_01_Servicios.png` | `/servicios` | Víctor | Storage / contacto | Captura revisada; cotejo final pendiente | Cloud, servidor local, modelo híbrido y solicitud de información | Implementación inicial; falta cotejo visual final |
| Sin frame identificado; catálogo ilustrado por referencias en mockups de suscripción | `/planes` | Víctor | Billing — Anthony | No | Nombre, descripción, precio, capacidad, usuarios y vigencia; confirmar catálogo | Implementación con referencias identificadas como tales |
| Sin frame identificado | `/contacto` | Víctor | Contacto pendiente | No | Formulario de solicitud de información (solo frontend) | Estructura de demostración; no envía los datos |
| `docs/figma/crear_cuenta/mk_04_resumen-contratacion.png` | `/suscripcion/confirmar` | Víctor | Billing — Anthony | Captura revisada; cotejo final pendiente | Plan, precio, espacio, vigencia, confirmación/cancelación simuladas | Implementación de demostración |
| `docs/figma/Pagos/mk_01_pago_resultado-exitoso_simulado.png` | `/suscripcion/exito` | Víctor | Billing — Anthony | Captura revisada; cotejo final pendiente | Resultado exitoso, plan, importe, fecha y referencia simulada | Implementación de demostración |
| Sin frame identificado | `/suscripcion/fallida` | Víctor | Billing — Anthony | No | Contratación fallida, sin cargo y opción para reintentar | Implementación inicial simulada |
| `docs/figma/Pagos/mk_02_suscripcion-actual.png` | `/suscripcion` | Víctor | Billing — Anthony | Captura revisada; cotejo final pendiente | Plan, estado, inicio, vencimiento y uso de almacenamiento/usuarios | Implementación de referencia; usuarios por definir |
| Sin frame identificado | `/suscripcion/cambiar-plan`, `/suscripcion/cambio-rechazado` | Víctor | Billing — Anthony | No | Cambio solicitado y rechazo si el uso excede el límite destino | Implementación inicial simulada |
| `docs/figma/Pagos/mk_03_sin-suscripcion.png` | `/suscripcion/vencida` | Víctor | Billing — Anthony | Captura revisada; cotejo final pendiente | Aviso, consulta de archivos, cargas bloqueadas y contratación | Implementación de demostración |
| `docs/figma/acceso/mk_01_login.png` | `/login` | Víctor | IAM — Sebastián | Sí: frame identificado; cotejo final de navegador pendiente | Espacio de trabajo, acción para continuar, registro y nota de acceso | Implementación inicial basada en el frame; el acceso sigue simulado |
| `docs/figma/crear_cuenta/mk_02_Registro de usuario.png` | `/registro` | Víctor | IAM — Sebastián | Captura revisada; cotejo final pendiente | Nombre, correo, organización, contraseña y confirmación; mostrar validación y cuenta creada pendiente de verificar | Implementación inicial simulada |
| `docs/figma/crear_cuenta/mk_02_Registro de usuario.png` | `/registro/completado` | Víctor | IAM — Sebastián | Captura revisada; cotejo final pendiente | Confirmación de creación y aviso de verificación por correo | Implementación inicial simulada |
| `docs/figma/crear_cuenta/mk_03_acceder_crear_cuenta.png` | `/login` | Víctor | IAM — Sebastián | Captura revisada; cotejo final pendiente | Correo, contraseña, recordar sesión y recuperar contraseña | Implementación inicial simulada; incluye errores de acceso |
| `docs/figma/crear_cuenta/mk_03_acceder_crear_cuenta.png` | `/nueva-contrasena` | Víctor | IAM — Sebastián | Sin frame específico | Nueva contraseña, confirmación, reglas de fortaleza, enlace vencido y éxito | Estructura inicial simulada |
| Sin frame identificado | `/verificar-correo` | Víctor | IAM — Sebastián | No | Código, reenvío, token inválido/vencido y verificación exitosa | Implementación inicial simulada |
| Sin frame identificado | `/recuperar-contrasena` | Víctor | IAM — Sebastián | No | Solicitud con correo, confirmación y enlace a nueva contraseña de demostración | Implementación inicial simulada |
| Sin frame identificado | `/sesion-vencida` | Víctor | IAM — Sebastián | No | Mensaje de sesión expirada y enlace para volver al login | Estructura inicial |
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

## Rutas de interfaz de demostración (2026-09-29)

Se preparó navegación y contenido inicial en estas rutas. La implementación visual usa la identidad compartida, pero **ningún frame se marca como revisado**: hay que cotejar dimensiones, textos, controles y estados con Figma antes de presentar la interfaz como aprobada.

| Ruta | Contenido implementado | Estado visual |
|---|---|---|
| `/` | Landing con accesos a registro, login y planes | Pendiente cotejo Figma; frame de landing disponible |
| `/servicios` | Servicios cloud, local e híbrido | Pendiente cotejo con `docs/figma/landing/mk_01_Servicios.png` |
| `/contacto` | Formulario de solicitud de información, sin envío | Pendiente de frame específico |
| `/registro` | Formulario local de demostración | Pendiente de frame |
| `/verificar-correo` | Confirmación de cuenta simulada | Pendiente de frame |
| `/login` | Selector de espacio de trabajo y acceso simulado | `docs/figma/acceso/mk_01_login.png`; revisar captura final del navegador |
| `/login` | Correo, contraseña, recordar sesión y recuperación | Pendiente cotejo con `docs/figma/crear_cuenta/mk_03_acceder_crear_cuenta.png` |
| `/recuperar-contrasena`, `/nueva-contrasena`, `/sesion-vencida` | Recuperación, cambio de contraseña y retorno al login tras expirar sesión | Pendiente de frame |
| `/planes` | Plan Demo documentado; demás precios/catálogos sin inventar | Pendiente de frame |
| `/dashboard` | Organización, usuario, plan, almacenamiento, usuarios, destino, accesos, archivos y actividad | Pendiente de frame específico; sigue el patrón de espacio de trabajo en `docs/figma/carga_archivos/mk_01_vista_panel_archivos_existentes.png` |
| `/dashboard/vacio` | Estado inicial de organización nueva, sin archivos ni actividad | Sin mockup específico |
| `/dashboard/cuota-excedida` | Aviso al 100% de uso y acceso para mejorar plan | Basado en `docs/figma/carga_archivos/mk_07_espacio_almacenamiento_alcanzado.png` |
| `/dashboard/super-admin` | Organizaciones, planes, instalaciones, actividad global y estado de plataforma | Sin mockup; métricas de muestra rotuladas como simuladas |
| `/archivos`, `/archivos/[folderId]`, `/archivos/cuota-excedida` | Mi espacio, lista de carpetas/archivos, carpeta vacía y con contenido, creación y validación, detalle, carga/errores, duplicados, versiones, descarga de demostración y estado de cuota llena | Basado en `docs/figma/carga_archivos/mk_01_vista_panel_archivos_existentes.png`, `mk_02_detalles_al_selecciona_archivo.png`, `mk_03_opciones_con_archivos.png` y `mk_07_espacio_almacenamiento_alcanzado.png`; cotejo final pendiente |
| `/papelera` | Papelera con estado vacío, restauración, confirmación y eliminación definitiva | Basado en `docs/figma/carga_archivos/mk_04_papelera.png`; cotejo final pendiente |
| `/perfil` | Perfil de cuenta: nombre editable en la demostración, correo de solo lectura, estado de verificación, acceso a recuperación de contraseña y organización asociada | Sin frame específico; campos basados en `USER` de `docs/modelo-minimo.md` y en el estado de cuenta documentado. Guardado solo local, pendiente de conectar con IAM y cotejo visual |
| `/configuracion`, `/auditoria` | Solo estructura inicial | Pendiente de frame |

Las acciones de demostración solo alteran datos locales del navegador. La selección de un archivo no transfiere sus bytes a SeaweedFS ni sustituye las operaciones de API de IAM, Billing o Files.
