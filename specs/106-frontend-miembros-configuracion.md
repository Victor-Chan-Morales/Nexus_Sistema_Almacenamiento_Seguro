# SPEC-106: GESTIÓN DE MIEMBROS EN CONFIGURACIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (Frontend / Integración) |
| **Responsable Principal** | Miguel (delegado por Víctor, ver `docs/equipo/asignaciones.md`) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/app/configuracion/`, `apps/web/src/lib/api/members.ts` (nuevo) |
| **Requisitos Vinculados** | RF-003, Curso §4.1 |
| **Dependencias** | SPEC-102 y SPEC-104 (API). Puede avanzar con un mock del contrato v0.5. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 1.5 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

Reemplazar el `PlaceholderPage` de `/configuracion` por una pantalla con la sección **"Miembros del equipo"**: tabla de miembros y formulario para agregar uno nuevo.

---

## 3. Fuera de Alcance (YAGNI)

- Editar, suspender o eliminar miembros; reenviar invitaciones.
- Otras secciones de configuración (preferencias, organización).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Administrador ve los miembros
  Dado un "tenant_admin" en /configuracion
  Entonces ve la tabla (nombre, correo, rol "Administrador"/"Colaborador", fecha de ingreso) y el contador "N de {userLimit} usuarios"

Escenario 2: Agregar miembro
  Cuando completa nombre, correo y rol y confirma, y la API responde 201
  Entonces la tabla se actualiza y se informa "Enviamos un correo a {email} para que defina su contraseña"

Escenario 3: Errores de negocio
  Cuando la API responde 422 MEMBER_ALREADY_EXISTS, EMAIL_BELONGS_TO_OTHER_ORGANIZATION o USER_LIMIT_EXCEEDED
  Entonces muestra el mensaje en español correspondiente y conserva lo escrito

Escenario 4: Colaborador
  Dado un usuario "colaborador"
  Entonces ve un aviso "Solo los administradores gestionan miembros" y NO se llama a la API de miembros

Escenario 5: Estados
  Entonces existen cargando, vacío (solo el administrador), error con reintento y datos
```

---

## 5. Contrato de API

Consume `CONTRACTS.md` v0.5, "Miembros de la organización". Funciones `getMembers()` y `addMember(input)` en `lib/api/members.ts`; tipos en `lib/api/types.ts`.

---

## 6. Datos y Esquema

No aplica.

---

## 7. Interfaz de Usuario

- Ruta `/configuracion`, dentro de `AppShell`. Insignias de rol según `docs/IDENTIDAD_VISUAL.md`.
- Mostrar el conteo y el límite que devuelve la API; el cliente no calcula cupos ni decide permisos (solo oculta lo administrativo según `session.role`).

---

## 8. Diseño Técnico

- `useLoad` para la lista (patrón existente); tras agregar, recargar la lista.
- Validación de correo y nombre en el cliente solo como ayuda; la API valida.

---

## 9. Plan de Tareas

- [ ] **T1 (25 min)**: `lib/api/members.ts` y tipos.
- [ ] **T2 (40 min)**: sección y tabla en `configuracion/page.tsx`, estados y aviso para `colaborador`.
- [ ] **T3 (25 min)**: formulario o modal de alta con mapeo de errores por `code`.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Verificación |
|---|---|---|
| Escenarios 1–5 | Manual | Con un administrador y un colaborador reales; agregar hasta alcanzar el límite de Demo (5) y comprobar `USER_LIMIT_EXCEEDED` |

---

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`: actualizar `/configuracion`.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Campos del contrato (`fullName`, `userLimit`); vista para `colaborador`; errores de negocio; dependencia explícita de 104. |
