# Plan simple para integrar el avance de Víctor con las PR del equipo

## Meta

Conectar el frontend de Víctor con los cambios de IAM, Billing y Files sin que las partes esperen respuestas distintas. Al final, el usuario podrá iniciar sesión, ver su plan y cuota, y trabajar con archivos usando datos reales.

## Orden de trabajo

### 1. Usar el contrato aprobado

`CONTRACTS.md` v0.3 y ADR-003 fijan las rutas y reglas para esta integración. Implementar las PR siguiendo esos documentos; si aparece una diferencia, actualizar primero el contrato y registrar la decisión en `SESSION_LOG.md`.

El contrato ya está aprobado para implementación por el integrador. No es necesario detenerse a pedir una aprobación adicional. Cada responsable puede corregir su PR usando la devolución individual enlazada abajo.

- Sebastián: [correcciones para PR #6 IAM](DEVOLUCION_SEBASTIAN_PR_6_IAM.md).
- Anthony: [correcciones para PR #4 Billing](DEVOLUCION_ANTHONY_PR_4_BILLING.md).
- Miguel: [correcciones para PR #5 Files/Storage](DEVOLUCION_MIGUEL_PR_5_FILES_STORAGE.md).

**Listo cuando:** las PR y consumidores implementan los contratos ya aprobados en `CONTRACTS.md`.

### 2. Integrar IAM y conectar la sesión

La web necesita saber quién inició sesión y si su sesión sigue vigente.

- Dashboard lee `organizationId` y `organizationName` del principal validado que entrega el guard JWT; no depende de `IamService`.
- Conectar login, registro, verificación, renovación y cierre de sesión a las rutas de v0.3.
- Confirmar que el token de acceso vive en memoria y que la renovación usa la cookie segura acordada.
- Probar que una visita sin sesión termina en login y que una sesión válida puede consultar `/auth/me`.

**Listo cuando:** IAM y Dashboard se pueden integrar sin depender de un servicio que ya no existe, y la web sabe iniciar, restaurar y cerrar una sesión.

### 3. Integrar Billing y mostrar plan y cuota

- Revisar la PR #4 de Anthony y comparar sus respuestas con `CONTRACTS.md`.
- Sin suscripción vigente, mostrar que no hay plan y cuota cero; no inventar una cuota predeterminada.
- Conectar la lista de planes y la activación del plan de demostración.
- Obtener el límite del plan y el uso desde Billing y Files; mostrar ambos en la pantalla de Dashboard.
- Mostrar los errores que devuelve la API, por ejemplo, si no se puede activar un plan.

**Listo cuando:** el plan y la cuota mostrados vienen de la API y no de datos de demostración.

### 4. Completar Files y cerrar la integración de archivos

La pantalla web ya consume las rutas y respuestas de `CONTRACTS.md` v0.3. El backend local aún expone rutas distintas y no implementa carga multipart ni descarga binaria, así que el flujo real queda pendiente hasta que Files implemente ese contrato.

- Ajustar el backend de Files a `GET /folders`, `GET /folders/:id/items` y `POST /folders`.
- Implementar la carga multipart y descarga binaria con los límites, la cuota y los errores acordados.
- Añadir reservas atómicas para que dos cargas simultáneas no excedan el almacenamiento disponible.
- Conectar el Drive y su carpeta raíz creados durante el registro.
- Luego verificar que se pueda crear carpeta, subir, listar y descargar, y que el Dashboard refleje el uso confirmado.

**Listo cuando:** la API real implementa v0.3 y el flujo de la pantalla completa esas operaciones sin respuestas simuladas.

### 5. Integrar los cambios en este orden

1. Sebastián, Anthony y Miguel corrigen en paralelo sus PR contra `CONTRACTS.md` v0.3; los cambios a archivos compartidos (`app.module.ts`, `main.ts`, `.env.example` y migraciones) deben coordinarse con Víctor.
2. Integrar IAM y verificar el principal autenticado, cookie, registro y hooks transaccionales.
3. Integrar Billing y Files; conectar el `SubscriptionCoordinator` para consultar uso/reservas en Files y delegar la persistencia transaccional en Billing.
4. Rebasar e integrar Dashboard y frontend con las APIs ya conformes al contrato.
5. Actualizar README y `SESSION_LOG.md` con resultados y pendientes reales.

Si una implementación no puede cumplir una ruta o regla aprobada, documentar el cambio propuesto en `CONTRACTS.md` y `SESSION_LOG.md` antes de cambiar el consumidor. La versión vigente sigue siendo la fuente para implementar.

### 6. Revisar el avance de Víctor y preparar su PR

Antes de publicar el cambio de Víctor:

- Confirmar que compila la web y la API.
- Revisar que ninguna pantalla muestre datos ficticios como datos reales.
- Revisar que el Dashboard use el tenant de la sesión y los servicios públicos de los módulos; no debe recibir el `organizationId` del navegador como prueba de acceso.
- Revisar que el token no se guarde en `localStorage`.
- Confirmar que la pantalla de archivos use la API, no el almacén de demostración.
- Dejar fuera de la PR archivos generados y documentos de revisión de compañeros que no sean parte de la implementación.
- Crear una rama nueva desde la base acordada, incluir solo los cambios de Víctor y abrir una PR para revisión.

## Lista final

- [ ] IAM implementa sesión y rutas de v0.3.
- [ ] Billing implementa catálogo, activación y límites de v0.3.
- [ ] Files implementa rutas, respuestas, uso y reservas de v0.3.
- [ ] Dashboard obtiene la organización del principal JWT y consulta Billing/Files.
- [ ] Login y renovación de sesión usan rutas disponibles y acordadas.
- [ ] Files usa la API real en lugar de datos de demostración.
- [ ] Dashboard muestra el plan y la cuota reales.
- [ ] El cambio compila y la PR contiene únicamente el trabajo que corresponde a Víctor.

## Situación al preparar este plan

El contrato v0.3 ya fija las decisiones de integración. La web y la API compilan; Dashboard y la pantalla de archivos ya llaman a los clientes definidos por el contrato. Aún falta que IAM publique el contexto y las rutas de sesión, que Billing aplique los límites aprobados y que Files implemente sus endpoints, cargas y reservas. Por eso compilar no equivale a tener validado el flujo completo.
