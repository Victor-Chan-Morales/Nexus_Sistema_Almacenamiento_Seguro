# Continuidad de trabajo — Víctor / Nexus

Este documento resume el trabajo y los acuerdos de la conversación para retomarlos desde otro equipo. No es una transcripción literal del chat.

## Objetivo

Víctor es responsable de la integración y del frontend común de Nexus. El recorrido del primer corte es registro, inicio de sesión, activación de plan demostrativo, dashboard, carpeta y carga/descarga de un archivo. Sebastián es dueño de IAM, Anthony de Billing y Miguel de Files/Storage. Víctor conecta los módulos y no reescribe su lógica de API.

## Estado del repositorio al guardar

- Rama activa: `feature/victor/integration-mvp`.
- La rama apunta al mismo commit que `main` y `origin/main`: `35fd10c` (`Merge pull request #1 from Victor-Chan-Morales/feature/victor/visual-identity`).
- La rama se creó para iniciar el plan individual de Víctor.
- Se instalaron las dependencias con `npm install`; el proceso reportó cero vulnerabilidades y una advertencia de obsolescencia de ESLint.
- Next.js arrancó y respondió HTTP 200 en `http://127.0.0.1:3000`. El servidor se dejó ejecutando en el entorno original; al cambiar de equipo habrá que volver a iniciarlo con `npm run dev:web`.
- Docker Compose reconoce `postgres` y `minio`, pero no fue posible iniciar los contenedores: acceso denegado a `/var/run/docker.sock`, incluso al reintentar con permisos elevados.
- El entorno local usado era Node `v22.23.1`, npm `10.9.8` y Docker Compose `v5.5.1`.

## Cambios locales que deben conservarse y revisar

Al arrancar Next.js se generaron o modificaron archivos locales. No se hizo commit ni se creó PR. Antes de continuar en otra máquina, conservar o transferir estos archivos si se desea mantener el mismo estado:

- `apps/web/tsconfig.json` fue ajustado por Next.js (incluye `jsx: react-jsx` y tipos de `.next/dev`).
- Se generaron `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, `apps/web/next-env.d.ts` y `package-lock.json`.
- Permanecen archivos locales sin seguimiento: los cuatro planes `.docx` y la carpeta `figma/` con imágenes. No eliminarlos.
- `CONTRACTS.md` tiene cambios locales recientes comunicados por el equipo; preservar su versión.
- En el momento de guardar, `docs/FIGMA_MAP.md` ya contiene un enlace al frame de landing, pero faltan las referencias y revisiones de las demás pantallas.

El workspace del otro equipo debe tener estos archivos sincronizados o copiados para que el estado local sea idéntico. Los artefactos sin seguimiento no se transfieren mediante un `git pull` normal.

## Contrato y decisiones

El equipo comunicó que el contrato fue aprobado. `CONTRACTS.md` ya no muestra el estado “PROPUESTO”, pero todavía conserva preguntas y discrepancias que deben cerrarse antes de integrar los módulos:

1. Sebastián debe confirmar cómo se resuelve la verificación de correo en la demo y cómo se manejará la sesión (cookie httpOnly u otra estrategia acordada). El frontend consumirá la decisión; no debe guardar tokens sensibles en `localStorage` por conveniencia.
2. Anthony y Miguel deben confirmar cuota, tamaños y tipos admitidos, y cómo se aplica el límite al cargar.
3. Miguel debe confirmar el drive inicial de demostración.
4. Anthony debe confirmar el comportamiento al cambiar de plan con una suscripción activa.
5. Víctor debe completar el mapeo de pantallas, campos, acciones y estados al revisar Figma.
6. Resolver diferencias de contrato/modelo antes de migraciones: límite de almacenamiento guardado en GB frente a respuesta API en bytes; `userLimit`, `description` y `validityDays` no están todos reflejados en el modelo de planes; confirmar los datos de carga y `FILE_VERSION`.
7. Registrar formalmente la aprobación del contrato, su versión y alcance en `CONTRACTS.md` y como nueva entrada en `SESSION_LOG.md`.

El espacio `apps/api` aún está documentado como pendiente de inicializar. No asumir que los endpoints propuestos ya existen. Cada responsable debe implementar y confirmar sus endpoints conforme al contrato.

## Figma y frontend

- Víctor está actualizando `docs/FIGMA_MAP.md`; respetar ese trabajo y coordinar cualquier cambio.
- El mapa actualizado incluye un frame enlazado para la landing; las rutas `/login`, `/registro`, `/planes`, `/dashboard` y `/archivos` siguen pendientes de cotejo con sus frames.
- Las pantallas actuales son esqueletos. Formularios y acciones están deshabilitados; no hay autenticación, Billing ni carga real conectados.
- Usar Inter y los tokens de `docs/IDENTIDAD_VISUAL.md`. No marcar una pantalla revisada sin compararla con su frame.

## Próximos pasos sugeridos

1. En el nuevo equipo, recuperar la rama `feature/victor/integration-mvp` y verificar el estado con `git status --short --branch`.
2. Asegurarse de conservar los cambios locales y los artefactos sin seguimiento anotados arriba.
3. Registrar formalmente la aprobación del contrato y cerrar con los responsables las decisiones abiertas de sesión, verificación, cuota, drive y suscripción.
4. Resolver las discrepancias entre `CONTRACTS.md` y el modelo antes de que los dueños creen migraciones.
5. Completar el mapa Figma; luego implementar y conectar el frontend por recorrido, conforme a las APIs que cada responsable confirme como existentes.
6. Resolver el acceso de Docker al daemon para probar PostgreSQL y MinIO.
7. Hacer aceptación integral con datos ficticios y documentar resultados reales y pendientes.

## Documentos de referencia

- `Plan_Trabajo_Victor_Integracion_Frontend.docx`
- `CONTRIBUTING.md`
- `ARCHITECTURE.md`
- `BUSINESS_RULES.md`
- `CONTRACTS.md`
- `ENTS_REGISTRY.md`
- `SESSION_LOG.md`
- `docs/FIGMA_MAP.md`
- `docs/IDENTIDAD_VISUAL.md`
- `docs/decisions/ADR-001-despliegue-del-corte-30.md`
