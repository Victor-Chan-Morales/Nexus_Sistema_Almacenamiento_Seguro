# SPEC-601: PANTALLA DE PERFIL CON DATOS DE LA SESIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (Frontend) |
| **Responsable Principal** | Víctor Chán Morales |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/profile-page.tsx` |
| **Requisitos Vinculados** | RF-001 |
| **Dependencias** | Ninguna |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) — **prioridad P2** |
| **Estimación** | 1.0 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

`/perfil` hoy guarda datos en `localStorage` (`lib/demo.ts`) y dice "cuenta de demostración". Debe mostrar solo datos reales de la sesión: nombre, correo, organización y rol.

---

## 3. Fuera de Alcance (YAGNI)

- **Editar el nombre o el correo:** no existe endpoint de actualización de perfil ni spec que lo cree. La versión anterior de esta spec lo pedía en el objetivo sin ninguna tarea que lo cumpliera; se retira.
- Cambiar la contraseña con sesión iniciada: el enlace "Cambiar" lleva al flujo de recuperación (SPEC-105).
- Foto de perfil y preferencias.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Datos reales
  Dado un usuario con sesión
  Entonces /perfil muestra su nombre, correo, organización y rol ("Administrador"/"Colaborador") tomados de la sesión (GET /auth/me)
  Y no usa ni escribe localStorage de demostración

Escenario 2: Sin leyendas de demostración
  Entonces no aparece "cuenta de demostración" ni "guardado en esta demostración"

Escenario 3: Cambiar contraseña
  Entonces el enlace lleva a /recuperar-contrasena
```

---

## 5. Contrato de API

Consume `GET /auth/me` (v0.4) o la sesión en memoria. Sin endpoints nuevos.

---

## 6. Datos y Esquema

No aplica.

---

## 7. Interfaz de Usuario

Ruta `/perfil`. Estados: cargando (restauración de sesión) y datos; sin edición.

---

## 8. Diseño Técnico

- Leer de `useSession()`; eliminar el uso de `readDemo`/`writeDemo` en este componente.

---

## 9. Plan de Tareas

- [ ] **T1 (40 min)**: reemplazar el estado local por la sesión y retirar el formulario editable y las leyendas de demostración.
- [ ] **T2 (20 min)**: etiqueta de rol y enlace de contraseña.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Verificación |
|---|---|---|
| Escenarios 1–3 | Manual | Iniciar sesión con un administrador y un colaborador y comparar con `/auth/me` |

---

## 11. Impacto en Documentación

Ninguno.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Retirada la edición de nombre (sin endpoint ni tarea); solo lectura con datos de sesión; prioridad P2. |
