# Cómo contribuir

## Antes de tomar una tarea

1. Lea `SYSTEM_PROMPT.md`, `BUSINESS_RULES.md`, `CONTRACTS.md` y la entrada vigente de `SESSION_LOG.md`.
2. Confirme en `ENTS_REGISTRY.md` quién es dueño de la carpeta/archivo.
3. Busque el frame Figma asociado en `docs/FIGMA_MAP.md` y revise `docs/IDENTIDAD_VISUAL.md` para los colores y tipografía compartidos.
4. Publique qué va a cambiar y qué contrato consume. Si no está acordado, marque la tarea como bloqueada por contrato, no lo invente en código.

## Ramas y commits

- `main` contiene únicamente cambios revisados y ejecutables.
- Use una rama por cambio: `feature/victor/web-shell`, `feature/sebastian/iam-register`, `feature/miguel/files-upload`, `feature/anthony/billing-plans`.
- Cree PR hacia `main`; no integre directamente.
- Use commits breves en español o inglés, con verbo: `feat(web): agregar ruta de registro`.
- Un PR debe incluir propósito, archivos tocados, cómo probar, captura si cambia interfaz, limitaciones y contrato afectado.

## Propiedad inicial

- Víctor: estructura y todas las pantallas frontend, navegación, sistema visual, mapa Figma e integración.
- Sebastián: dominio IAM de API; provee a Víctor campos, estados, errores y aceptación de las pantallas de acceso.
- Miguel: dominio Files/Storage de API; acuerda a Víctor estados/errores del explorador y transferencia de archivos.
- Anthony: dominio Billing de API; acuerda a Víctor estados/errores de catálogo y suscripción.

Víctor es integrador de frontend y no reescribe lógica de API ajena. Los tres responsables de dominio no editan pantallas sin acuerdo con Víctor. Cualquier cambio de propiedad se registra en `ENTS_REGISTRY.md` y `SESSION_LOG.md`.

## Archivos compartidos

Coordinen antes de cambiar:

- `package.json`, workspace, configuración común y `docker-compose.yml`.
- `CONTRACTS.md`, `BUSINESS_RULES.md`, `ENTS_REGISTRY.md` y `docs/modelo-minimo.md`.
- Esquema/migraciones compartidas y componentes compartidos de `apps/web/src/components`.
- `docs/IDENTIDAD_VISUAL.md` y `apps/web/src/app/globals.css`: Víctor mantiene los tokens compartidos; propongan cambios en PR y registren cualquier actualización de la identidad visual.

Un solo PR debe cambiar una misma migración. Los módulos envían una propuesta de migración al integrador; no editen la misma tabla/esquema concurrentemente.

## Reglas técnicas

- Mantenga las dependencias y versiones aprobadas; no agregue paquetes para resolver una función pequeña sin justificarlo.
- Mantenga `strict-ssl=true` en npm. Las etapas Alpine del Dockerfile instalan `ca-certificates`; si una red inspecciona TLS con una CA propia, añádala al almacén de confianza de la imagen, no desactive la validación.
- No copie componentes compartidos para darles estilos distintos; amplíe el componente o cree uno específico cuando las responsabilidades realmente difieran.
- No acople pantallas a respuestas inventadas. Use `apps/web/src/lib/api/README.md` y tipos centralizados cuando el contrato esté aprobado.
- Toda decisión sobre almacenamiento pasa por `StorageProvider`; no llame SeaweedFS desde IAM, Billing o el frontend.
- En todas las consultas de recursos, valide organización y rol en backend.
- Nunca suba `.env`, contraseñas reales, tokens, llaves, credenciales ni archivos reales. Use `.env.example` con valores solo de desarrollo.

## Criterio de revisión

El autor prueba el cambio y pega los pasos en el PR. Un compañero revisa la integración. Rechace código que contradiga Figma, omita el alcance de tenant o declare éxito en una simulación sin indicarlo.
