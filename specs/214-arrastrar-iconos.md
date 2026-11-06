# SPEC-214: ARRASTRAR Y SOLTAR E ÍCONOS POR TIPO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/file-browser-live.tsx` |
| **Requisitos Vinculados** | UI/UX §8 (Drag & Drop) |
| **Dependencias** | Ninguna |
| **Prioridad** | P1 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Subir archivos arrastrándolos al explorador y distinguir su tipo de un vistazo con mejores íconos.

## 3. Fuera de Alcance

- Mover archivos arrastrando entre carpetas, que tampoco cubre SPEC-212.
- Subir carpetas completas.
- Cambios en la API o librerías nuevas.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Soltar un archivo
  Cuando arrastra un archivo permitido sobre el explorador
  Entonces la zona se resalta y, al soltar, sube a la carpeta abierta y aparece en la lista

Escenario 2: Varios archivos
  Cuando suelta 5 archivos
  Entonces se suben de uno en uno y se informa el resultado de cada uno
  Y un fallo no detiene los demás

Escenario 3: Tipo o tamaño no permitido
  Cuando suelta un archivo no permitido
  Entonces no se envía y muestra el mismo mensaje que el botón de subir

Escenario 4: Sin plan o con otra acción en curso
  Entonces la zona no acepta archivos

Escenario 5: Sin confusión con otros arrastres
  Cuando arrastra texto o un enlace
  Entonces no se activa la zona

Escenario 6: Íconos
  Entonces PDF, Word, Excel, PowerPoint, imagen, TXT y ZIP muestran un ícono distinto
  Y uno desconocido muestra un ícono genérico

Escenario 7: Teclado
  Entonces el botón "Subir archivo" sigue funcionando como alternativa
```

## 5. Contrato de API

Sin cambios. Usa `POST /files/upload`.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

- Resaltado con los tokens de `docs/IDENTIDAD_VISUAL.md`, con el texto "Suelta para subir a <carpeta>".
- Estados: arrastrando, subiendo (`n de m`), éxito y error.
- Íconos en `components/ui-icon.tsx`. No se agrega librería (REGLAS §1).

## 8. Diseño Técnico

- Extraer la validación y subida actuales de `uploadSelected` a `uploadOne(file)` para que ambos caminos usen lo mismo.
- Eventos: `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`, con `event.dataTransfer.types.includes("Files")` y un contador para evitar parpadeo con elementos hijos.
- Secuencial, no en paralelo: la API limita a 3 cargas simultáneas por usuario.
- Reemplazar `FileGlyph` y sus clases `glyph-*`.
- Validar cuota en el cliente es solo cortesía (REGLAS, regla 2); la API decide.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: Extraer `uploadOne`.
- [ ] **T2 (50 min)**: Zona de soltar y progreso.
- [ ] **T3 (40 min)**: Íconos y prueba manual.

**Archivos permitidos:** `components/file-browser-live.tsx`, `components/ui-icon.tsx`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–7 | Manual y `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code (revisión) | Corrige la referencia a SPEC-212. Aprobado por el coordinador (2026-11-04). |
