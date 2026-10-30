# SPEC-101: DECORADOR Y GUARD DE ROLES RBAC EN API

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (Zona Protegida - Seguridad y Control de Acceso) |
| **Responsable Principal** | Sebastián (Dominio IAM) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/` |
| **Requisitos Vinculados** | RF-003 |
| **Dependencias** | Ninguna. **Bloquea a** 102, 104, 302 y 402 (usan `@Roles`). Va primero. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 2.0 h |
| **Estado** | Aprobada (2026-10-28, Víctor Chán) |

---

## 2. Objetivo

Crear el decorador `@Roles(...)` y el `RolesGuard` para restringir endpoints según el rol de la membresía activa (`tenant_admin`, `colaborador`). Hoy cualquier usuario autenticado puede invocar cualquier endpoint. El rol llega en `req.user.role`, que `JwtStrategy` ya toma de la BD en cada request (un cambio de rol surte efecto inmediato).

---

## 3. Fuera de Alcance (YAGNI)

- Permisos granulares por archivo o carpeta (`files.resource_access`): no en este corte.
- Roles personalizados por tenant, `auditor` y `super_admin`. **Super Admin no es un rol** (es `iam.user.is_super_admin`); Auditor no se implementa (ADR-007 §3).
- Esta spec **no decora endpoints de otros módulos**: cada dueño aplica `@Roles` en su propia spec según la matriz de ADR-007 §4 (102/104: Sebastián; 302/402: Anthony).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Rol requerido presente
  Dado un usuario autenticado con rol "tenant_admin"
  Cuando invoca un endpoint decorado con @Roles(Role.TENANT_ADMIN)
  Entonces el guard permite el paso

Escenario 2: Rol insuficiente
  Dado un usuario autenticado con rol "colaborador"
  Cuando invoca un endpoint decorado con @Roles(Role.TENANT_ADMIN)
  Entonces responde 403 con { code: "FORBIDDEN_ROLE", message, requestId }
  Y el handler no se ejecuta

Escenario 3: Endpoint sin @Roles
  Dado un endpoint con solo el guard JWT
  Cuando lo invoca cualquier usuario autenticado
  Entonces el guard permite el paso

Escenario 4: Falla cerrada
  Dado un endpoint decorado con @Roles(...) y una request sin req.user o con un rol desconocido
  Entonces responde 403 FORBIDDEN_ROLE (nunca permite por defecto)

Escenario 4b: Falla cerrada sin @Roles o con @Roles() vacío
  Dado una request sin req.user en un endpoint sin @Roles
  O un endpoint con @Roles() vacío (en el método o en la clase)
  Entonces responde 403 FORBIDDEN_ROLE

Escenario 5: Decorador de clase y de método
  Dado un controlador decorado a nivel de clase y un método con otro @Roles
  Entonces prevalece el decorador del método
```

---

## 5. Contrato de API

No crea endpoints. Error común (ver `CONTRACTS.md` v0.5, "Roles y autorización"):

- **HTTP:** `403 Forbidden`
- **Cuerpo:** `{ "code": "FORBIDDEN_ROLE", "message": "Tu rol no tiene permiso para esta acción.", "requestId": "uuid" }`

El `ApiExceptionFilter` solo reenvía `code`, `message` y `requestId`: **el cuerpo no incluye `requiredRoles`**.

---

## 6. Datos y Esquema

- **¿Modifica BD?** No. Usa `iam.role.name` (`tenant_admin`, `colaborador`) ya presente en `req.user.role`.

---

## 7. Interfaz de Usuario (UI/UX)

- El frontend oculta las acciones administrativas según `session.role` y, si recibe `403 FORBIDDEN_ROLE`, muestra "No tienes permiso para esta acción". El ocultamiento es solo visual; la API autoriza.

---

## 8. Diseño Técnico

```typescript
// modules/iam/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '../domain/enums';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

```typescript
// modules/iam/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // El decorador del método prevalece sobre el de la clase.
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user) throw IamErrors.forbiddenRole();
    if (required === undefined) return true;

    // Un @Roles() vacío no concede acceso a nadie: [] no contiene ningún rol.
    if (!Array.isArray(required) || !required.includes(user.role)) throw IamErrors.forbiddenRole();
    return true;
  }
}
```

- **Uso:** `@UseGuards(AuthGuard('jwt'), RolesGuard)` — el guard JWT va primero porque `RolesGuard` lee `req.user`.
- **Tipos:** el parámetro de `@Roles` es el enum `Role` (no `string`): un error de escritura como `'collaborator'` no compila. `AuthUser.role` ya es `Role`, así que no hace falta cast.
- **Errores:** `IamErrors.forbiddenRole()` en `iam.errors.ts`, junto al resto de errores de IAM.
- **Falla cerrada:** sin `req.user` responde 403 aunque el endpoint no tenga `@Roles`. Un `@Roles()` vacío deniega a todos (no anula la restricción de la clase) y unos metadatos que no son array también se rechazan (evita que `includes` haga una búsqueda por subcadena sobre un string).
- **Registro:** `RolesGuard` **no** se registra en `providers` ni `exports` de `IamModule`. Al usarse en `@UseGuards(...)`, Nest lo instancia en el módulo del controlador y `Reflector` está disponible globalmente; basta con importar la clase.
- **Auditoría:** no registra evento.
- **Riesgos:** (a) olvidar `AuthGuard` antes que `RolesGuard` → siempre 403 (falla cerrada, detectable en pruebas); (b) `@Roles` en un endpoint sin sesión → 403, no 401.

---

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: `roles.decorator.ts` con `ROLES_KEY` y `Roles(...roles: Role[])`.
- [ ] **T2 (40 min)**: `roles.guard.ts` según la firma anterior.
- [ ] **T3 (50 min)**: `roles.guard.spec.ts` con los 5 escenarios (con `Reflector` y `ExecutionContext` simulados).
- [ ] ~~**T4 (10 min)**: registrar y exportar `RolesGuard` en `IamModule`.~~ Descartada: no es necesario (ver §8, "Registro").

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–5 y 4b | Unitaria | `modules/iam/guards/roles.guard.spec.ts` |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5: sección "Roles y autorización".
- [ ] `ENTS_REGISTRY.md`: sin entidad nueva.

---

## 12. Preguntas Abiertas

Ninguna. Decisiones de rol y matriz: ADR-007 §3 y §4.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Rol `colaborador`; sin `auditor`/`super_admin`; el 403 no devuelve `requiredRoles`; sin decorar endpoints ajenos; falla cerrada; tipado con el enum `Role`. |
| 2026-10-29 | Víctor Chán | Ajuste tras la revisión de la PR #15: sin `req.user` el guard deniega también sin `@Roles`; `@Roles()` vacío deniega a todos; se rechazan metadatos que no son array; se quita el cast `as Role`; error centralizado en `IamErrors.forbiddenRole()`; se descarta T4 (registrar en `IamModule`). Nuevo escenario 4b. |
