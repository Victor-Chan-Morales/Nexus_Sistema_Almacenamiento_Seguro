# Revisión del diagrama de clases

**Estado:** revisión técnica inicial; requiere acuerdo del equipo antes de modificar migraciones o tratar el dibujo como modelo aprobado.  
**Referencia nueva:** diagrama de clases compartido por Víctor, archivo SVG con AuthService, BillingService, InstallationService y DatabaseServiceClient.  
**Comparación:** frente a DiagramaClases.svg entregado anteriormente.

## Resultado de la comparación

- El diagrama pasa de 29 a 33 clases. Agrega AuthService, BillingService, InstallationService y DatabaseServiceClient; no elimina clases.
- No se detectaron cambios de atributos en las clases que ya existían. El cambio se concentra en métodos y asociaciones.
- Se trasladan operaciones de entidades a servicios de aplicación. Esto puede aclarar responsabilidades, siempre que cada operación tenga un dueño y que no se duplique.
- Varias relaciones que expresaban pertenencia, autorización y destino dejaron de mostrarse. Los identificadores en atributos o parámetros no sustituyen automáticamente asociaciones UML ni claves foráneas.

## Revisión necesaria antes de implementar

| Prioridad | Elemento | Hallazgo | Acción requerida |
|---|---|---|---|
| Bloqueante | Usuario, Membresía, Organización y Sesión | Ya no se muestran Usuario–Membresía ni Usuario–Sesión. | Dibujar las asociaciones y multiplicidades. Confirmar que las claves foráneas y la unicidad de usuario-organización sigan el diccionario. |
| Bloqueante | Destino y cifrado | Ya no se muestran Carpeta–Destino, FileVersion–Destino ni FileVersion–TenantEncryptionKey. FileVersion tampoco muestra sizeBytes, uploadedBy, uploadedAt ni kekId. | Restaurar relaciones/campos requeridos por el diccionario y las reglas de almacenamiento, cuota y cifrado. |
| Bloqueante | Alcance organizacional | Se omiten las asociaciones de Organización con InstallationRequest e Installation; User–ResourceAccess y Team–User tampoco se muestran. | Expresar ownership y sujetos autorizados para impedir que el modelo pierda límites multi-tenant. |
| Alta | Billing | Plan no muestra userLimit; el diagrama usa storageLimitGb mientras CONTRACTS expone storageLimitBytes. El diccionario persiste storage_limit_gb. | Acordar unidad interna/API y completar el mapeo. Descripción y vigencia aparecen en reglas/contrato pero no están en la tabla PLAN del diccionario: resolver esa diferencia antes de fijar el esquema. |
| Alta | Auditoría | El evento mostrado tiene actionType, result y recordHash, pero no organización, actor, recurso, correlación, fecha ni prevHash. | Alinear AuditEvent con el diccionario y con la regla de cadena por organización antes de afirmar integridad o inmutabilidad. |
| Alta | DatabaseServiceClient | Un cliente común concentra lecturas/escrituras de IAM, Files y Audit. | No aprobarlo como servicio de aplicación compartido. Separar puertos/repositorios por dominio; mantener compartida solo la infraestructura de conexión si corresponde. |
| Media | IAM | AuthService añade autenticación, TOTP, verificación y restablecimiento, mientras User conserva operaciones con nombres parecidos. | Definir límites: servicio de aplicación coordina el caso de uso; User conserva solo comportamiento propio de su estado. Evitar dos implementaciones de la misma operación. |
| Planificación | Alcance | El diagrama incluye instalación, MFA, recuperación, cifrado, enlaces y auditoría avanzada. | Mantener estas capacidades en el alcance final; asignar cada una a un hito y no interpretarlas como compromiso inmediato del avance funcional. |

## Impacto en el trabajo existente

- La paleta, Inter, la landing y la estructura visual no cambian por este diagrama.
- Las responsabilidades de módulo siguen siendo IAM (Sebastián), Billing (Anthony), Files/Storage (Miguel) e integración/frontend (Víctor).
- Sí deben alinearse modelo mínimo, contrato API y reglas para tamaño real del archivo, cuota, usuario-organización, destinos y auditoría.
- No se modifican migraciones ni se conectan pantallas a campos nuevos hasta que el equipo apruebe el modelo y el contrato.

## Criterio para cerrar la revisión

1. Publicar una versión corregida del diagrama con asociaciones y multiplicidades explícitas.
2. Acordar los campos faltantes comparando el diccionario, BUSINESS_RULES.md y CONTRACTS.md.
3. Confirmar qué clases pertenecen al 50% y cuáles quedan para iteraciones posteriores.
4. Actualizar este documento con la decisión, fecha y responsables; después revisar modelo, contrato y migraciones.
