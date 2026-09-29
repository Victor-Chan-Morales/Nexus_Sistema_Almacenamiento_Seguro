# Reglas de negocio de Nexus

Estas reglas traducen la propuesta aprobada, los lineamientos del curso y el diccionario de datos. Los nombres de campos que aparecen aquí siguen la terminología del diccionario. Las reglas marcadas para 30% son un subconjunto de entrega, no la definición completa del producto.

## Estado y fuentes

- **Producto final:** almacenamiento seguro organizacional, con gestión de identidad, roles, archivos y versiones, destinos cloud/on-premises/híbridos, enlaces protegidos, auditoría, planes y despliegue Docker.
- **Avance funcional 30%:** recorrido vertical pequeño y repetible. Se puede usar una sola implementación MinIO de desarrollo; esto no elimina el objetivo futuro de varios destinos.
- Fuente visual: mockups reales de Figma. No se agregan campos ni acciones a una pantalla aprobada sin acuerdo.
- Si la propuesta, el lineamiento, el diccionario o una regla aquí chocan, documenten el caso en `SESSION_LOG.md` y acuerden cuál prevalece antes de implementar.

## Identidad y organizaciones

1. Una dirección de correo identifica una cuenta única; la comparación se hace sin distinguir mayúsculas/minúsculas y se conserva una forma normalizada para índices y login.
2. Una contraseña nunca se guarda en claro; el campo de persistencia es un hash Argon2id.
3. El registro relaciona al usuario con una organización y una membresía. Si se crean las tres entidades en el mismo flujo, deben confirmarse juntas o revertirse juntas.
4. La membresía se identifica de forma única por el par `(user_id, organization_id)`, según el diccionario.
5. Toda lectura/escritura de datos de cliente usa la organización obtenida de la sesión/membresía del backend. Ignorar o rechazar cualquier `organizationId` manipulable enviado por el navegador.
6. Una cuenta con membresía suspendida o una organización suspendida/cancelada no puede operar sus recursos normales. El estado se valida en cada request, no solo al iniciar sesión.
7. La cuenta con `is_super_admin` administra funciones globales de plataforma; no implica autorización automática para actuar como miembro de cualquier organización sin un flujo auditado.

## Roles y permisos

| Rol | Alcance funcional |
|---|---|
| Super Admin | Administración de plataforma, tenants, planes e infraestructura; actividad global autorizada y auditada. |
| Tenant Admin | Administra usuarios, permisos, políticas y configuración de su organización. |
| Colaborador | Opera archivos dentro de las concesiones de su organización/equipo. |
| Auditor | Consulta trazabilidad de su alcance; no altera archivos ni permisos. Su modelado en `ROLE` debe acordarse porque el diccionario enumera inicialmente `tenant_admin` y `colaborador`. |

En el primer corte se permite un rol mínimo de administrador para la cuenta que registra la organización. No implementar autorización solo ocultando botones; cada acción debe verificarse en API. La matriz completa de permisos queda para el diseño RBAC del alcance final.

## Planes, suscripciones y pago simulado

1. Cada plan debe tener nombre, descripción, precio, vigencia, límite de almacenamiento y límite de usuarios; los valores salen del catálogo persistido, no se inventan en frontend.
2. Activar una suscripción registra organización, plan, estado `active`, fecha de inicio y de fin si aplica.
3. Como regla inicial propuesta, una organización tiene como máximo una suscripción `active` a la vez; el historial conserva suscripciones vencidas/canceladas. El equipo debe revisar esta restricción con Billing antes de migrar.
4. Las operaciones de pago/renovación llevan el indicador de simulación; no solicitar tarjetas, no hacer cargos reales y no guardar datos financieros.
5. Al vencer una suscripción se respetan los estados definidos en el diccionario (`active`, `expired`, `cancelled`) y se aplica una decisión de acceso/cuota documentada antes de programarla.
6. La capacidad total se mide en bytes; convertir a GB solo para presentación. Nunca aceptar el valor de uso enviado por el cliente.

## Carpetas, archivos y destinos

1. Un archivo pertenece a una carpeta y organización. La carpeta y el drive deben pertenecer al mismo tenant.
2. Una carpeta raíz tiene `parent_folder_id = NULL`. Un padre no puede causar ciclos ni pertenecer a otro drive u organización.
3. La clave del objeto en MinIO/S3 la genera el servidor; el nombre original es metadato visible, no ruta de almacenamiento.
4. El binario no se guarda en PostgreSQL. `FILE_VERSION` mantiene `object_key`, tamaño real (`size_bytes`), checksum, número secuencial y quién/cuándo cargó.
5. La primera carga exitosa crea la primera versión (número 1) y actualiza `FILE.current_version_id`; futuras versiones incrementan secuencialmente sin sobrescribir bytes anteriores.
6. Se descuenta/contabiliza el espacio con el tamaño real confirmado de versiones activas conforme a la regla final de cuota, no con el tamaño declarado en el navegador.
7. Antes de cargar, comprobar organización, permisos, carpeta, tamaño máximo del plan y tipo admitido. Confirmar tamaño real en el servidor.
8. No responder éxito si Storage falla o si no se guardaron los metadatos. Si una escritura parcial deja objeto huérfano, intentar compensación y dejar registro operativo seguro.
9. El destino efectivo puede heredarse de organización/carpeta según la política; el cliente no puede sobrescribir destinos permitidos ni consultar credenciales.
10. Las operaciones de lista, preview, descarga, eliminación, enlace y versión deben verificar tenant y permiso incluso si reciben UUID. El error de recurso ajeno no revela su existencia.

## Consistencia estructural del modelo

El diagrama de clases describe responsabilidades y relaciones, pero no reemplaza el diccionario ni aprueba por sí mismo una migración. Las asociaciones que limitan el acceso deben quedar visibles en el diagrama y protegidas con claves foráneas/índices en PostgreSQL:

1. Usuario pertenece a organización mediante Membresía; una membresía pertenece a un usuario y una organización. Se mantiene la unicidad del par user_id + organization_id. Una sesión pertenece a un usuario.
2. Cada drive, carpeta, archivo, destino, suscripción, solicitud de instalación e instalación tiene una organización propietaria o un camino inequívoco para validar ese tenant. No se autoriza por UUID solamente.
3. Una carpeta tiene un drive y puede heredar el destino de la organización. Cada FileVersion conserva el destino donde se escribió y la referencia de llave usada si el cifrado está habilitado.
4. FileVersion registra el tamaño real, checksum, object_key, uploaded_by y uploaded_at. El valor del navegador declarado nunca determina la cuota consumida.
5. El modelo de Plan debe concordar con el catálogo: límite de almacenamiento, límite de usuarios y precio simulado. La unidad de persistencia/API y los campos descripción/vigencia deben resolverse entre el diccionario y CONTRACTS.md antes de crear migraciones.
6. Todo AuditEvent conserva como mínimo organización, actor, acción, resultado, recurso si existe, correlation_id y hora UTC. Para la cadena por organización se guardan prev_hash y record_hash; no se guardan secretos ni contenido.
7. Los servicios de aplicación pueden orquestar estos casos, pero no deben eliminar relaciones de pertenencia ni duplicar comportamiento entre servicio y entidad.

La revisión del diagrama recibido y sus pendientes está en `docs/revision-diagrama-clases.md`. Las nuevas clases de instalación, MFA, recuperación, cifrado completo, enlaces y auditoría avanzada pertenecen al alcance final, salvo que el plan del hito las priorice explícitamente.

## Alcance funcional por corte

### Recorrido objetivo para 30%

- Registro y login con almacenamiento seguro de contraseña.
- Asociación usuario-organización y ruta privada con sesión válida.
- Ver catálogo y activar suscripción de demostración.
- Ver organización, plan y espacio usado en dashboard.
- Crear carpeta, cargar un archivo pequeño a MinIO, listar metadatos y descargar el mismo contenido.
- Confirmar en API que otra organización no puede listar ni descargar esos recursos.

### Requerimientos del producto final que siguen vigentes

- Verificar correo, recuperar contraseña, sesiones revocables, MFA/TOTP y RBAC completo.
- Versionado, papelera/recuperación, enlaces temporales protegidos y revocación.
- Auditoría centralizada e integridad de registros.
- Cifrado en streaming con libsodium y gestión Envelope DEK/KEK.
- Selección de destino cloud, on-premises e híbrido y despliegue on-premises reproducible.
- Renovaciones e historial de operaciones simuladas conforme al curso.

Si algo se pospone del 30%, anótelo como pendiente del siguiente corte; no lo describa como requisito eliminado.

## Reglas de auditoría y privacidad

- Registrar operaciones críticas según política: login, cambios de permisos, carga, descarga, compartir y eliminación.
- Guardar actor, organización, recurso, resultado, hora y correlation ID que sean necesarios; no guardar contraseñas, tokens completos, DEK/KEK ni contenido.
- El objetivo de auditoría inmutable/hash-chain debe explicarse antes de presentar una implementación simple como cumplimiento completo.
