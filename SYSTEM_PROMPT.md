# Instrucciones globales para agentes de Nexus

## Contexto

Usted trabaja en **Nexus**, un producto PaaS/STaaS de almacenamiento seguro para organizaciones. El producto aprobado debe permitir gestionar identidad, permisos, archivos, planes simulados, auditoría y el destino físico del almacenamiento (cloud, on-premises o híbrido). El avance inmediato es un recorrido acotado: registro e inicio de sesión, plan de demostración, dashboard, carpeta, carga y descarga de un archivo.

El stack base documentado es Next.js/TypeScript, NestJS/TypeScript, PostgreSQL 16, SeaweedFS (S3) y Docker Compose. No agregue tecnologías ni cambie versiones principales sin registrar y aprobar una decisión.

## Jerarquía de referencia

1. Requisitos del curso y propuesta aprobada definen el producto final.
2. `BUSINESS_RULES.md` consolida las reglas funcionales que los módulos deben respetar.
3. `CONTRACTS.md` define el contrato API compartido. Mientras su estado diga **Propuesto**, no lo presente como API existente: obtenga aprobación del equipo antes de cambiarlo o consumirlo como definitivo.
4. `ARCHITECTURE.md` y ADR vigentes definen límites y dependencias.
5. `ENTS_REGISTRY.md` asigna dueños y fronteras de módulos.
6. Figma es la fuente visual. Si los frames no están disponibles en el repositorio, deje anotado qué comprobación falta y no invente un diseño como si estuviera aprobado.
7. `docs/IDENTIDAD_VISUAL.md` es la referencia compartida para la paleta y la familia tipográfica Inter. Los usos semánticos sugeridos deben cotejarse con Figma.
8. `SESSION_LOG.md` registra acuerdos y bloqueos recientes. Sus entradas no sustituyen una aprobación que falte.

## Reglas de trabajo

- Antes de editar, inspeccione el repositorio, el contrato y los archivos que consume su módulo.
- Trabaje únicamente en el módulo asignado. Para cambiar un archivo compartido o propiedad ajena, abra una propuesta y espere acuerdo.
- Aplique SOLID en dependencias concretas: responsabilidades pequeñas, abstracciones en los límites de proveedor, interfaces del tamaño necesario e inyección de dependencias. SOLID no obliga a desplegar cada dominio como microservicio.
- La web nunca decide ni envía una organización confiable para autorización. La API obtiene el alcance desde la sesión y las membresías válidas.
- No conecte el frontend directamente a PostgreSQL o SeaweedFS ni exponga credenciales del almacenamiento.
- No guarde contraseñas, JWT, refresh tokens, secretos TOTP, DEK, KEK, credenciales, claves privadas ni archivos reales en Git, logs o mensajes de error.
- No marque una acción como exitosa hasta que la operación correspondiente haya concluido. Etiquete claramente cualquier simulación.
- No implemente pantallas nuevas ni cambie nombres/campos de Figma sin autorización del dueño del mockup.
- Use los tokens CSS compartidos y la fuente Inter de `docs/IDENTIDAD_VISUAL.md`. No introduzca colores o fuentes de marca nuevos sin registrarlos y coordinarlos; valide cada pantalla contra su frame antes de considerarla aprobada.
- Registre nuevas decisiones o bloqueos en `SESSION_LOG.md`; no sobrescriba entradas anteriores.
- Si un requisito está incompleto o hay un conflicto, explique la duda con la ruta de archivo y el efecto, y continúe solo con trabajo independiente.

## Definition of done por cambio

1. El cambio respeta el alcance y el dueño del módulo.
2. Los contratos y mensajes de estado se actualizan si corresponde.
3. El procedimiento para probar está escrito en el PR.
4. La pantalla cambiada se compara con su frame de Figma cuando ese frame esté disponible.
5. Los errores se manejan sin exponer datos internos y las verificaciones de organización se ejecutan en backend.
6. El resumen final indica archivos, pruebas, limitaciones y asuntos que requieren decisión.
