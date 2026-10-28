## 📋 Resumen del Cambio

- **ID de la Especificación:** `SPEC-XXX` (enlace: `specs/XXX-nombre.md`)
- **Módulo afectado:** `apps/api/src/modules/<iam|files|billing|audit|integration>` / `apps/web/src/...`
- **Dueño del módulo:**
- **Contrato o regla afectada:** `CONTRACTS.md` (sección) / ADR
- **Rutas o frame de Figma (si cambia UI):**
- **Autor:** (tu usuario de GitHub)
- **Aprobador requerido:** @Victor-Chan-Morales (Coordinador General)

---

## 💡 Explicación con tus propias palabras

*Explica en 2 a 4 líneas qué hace este cambio, por qué se hizo así y cómo se asegura de no romper nada existente:*

>

---

## 📁 Archivos tocados

<!-- Señala configuración compartida, migraciones o archivos de otro dueño y confirma que ese dueño lo acordó. -->

---

## ✅ Criterios de Aceptación Verificados

- [ ] **Escenario 1 (éxito):** *[descripción]* → cubierto por prueba en `...spec.ts`
- [ ] **Escenario 2 (permisos / error):** *[descripción]* → cubierto por prueba en `...spec.ts`
- [ ] **Aislamiento multitenant:** se verificó que ninguna operación afecte a otras organizaciones.

---

## 🛡️ Declaración de Zonas Protegidas

*Marca si este PR modifica alguna de las siguientes zonas:*
- [ ] Base de datos / migraciones (`database/migrations/`)
- [ ] Autenticación / JWT / sesiones (`modules/iam/`)
- [ ] Cifrado / criptografía (`files-crypto.service.ts`)
- [ ] Variables de entorno / Docker (`docker-compose.yml`, `.env.example`)
- [ ] *Ninguna de las anteriores (cambio estándar)*

---

## 🧪 Pruebas locales ejecutadas

- [ ] `npm run build:api` compila limpiamente (0 errores de TypeScript).
- [ ] `npm run build:web` compila limpiamente (y `npm run lint:web` si tocaste la web).
- [ ] `npm run test:api` pasa completa.
- [ ] Probado manualmente en navegador / Postman. Pasos para reproducirlo:
  1.
  2.
  3.

## 📸 Evidencia visual

<!-- Si cambia la interfaz: captura comparada con Figma. -->

---

## ⚠️ Alcance y limitaciones

- [ ] No incluí secretos, datos reales ni archivos de usuarios.
- [ ] Verifiqué tenant y permisos en el backend cuando aplica.
- [ ] Marqué explícitamente las operaciones simuladas.
- [ ] Actualicé contratos, registro o bitácora si hubo cambios (`CONTRACTS.md`, `ENTS_REGISTRY.md`, `SESSION_LOG.md`).
- Limitaciones conocidas de este PR:

---

## 🔍 Checklist para el Coordinador (Víctor Chán)

- [ ] El código nuevo no contiene `any`, `console.log` ni código comentado.
- [ ] El backend valida el `organizationId` desde el token JWT.
- [ ] No se exponen entidades de TypeORM directamente en controladores.
- [ ] Se actualizó la documentación vinculada (`CONTRACTS.md` si hubo cambios en la API).
