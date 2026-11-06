# Evidencia del PR #53

Capturas de Chrome contra la web y la API locales con datos de demostración.

| Spec | Evidencia |
|---|---|
| 214 | [Zona de arrastre](214-zona-arrastre.png) y [resultado de un TXT válido y un archivo rechazado](214-resultados.png). |
| 307 | [Catálogo a 360 px](307-planes-360.png), [plan actual](307-plan-actual.png), [catálogo con dashboard no disponible](307-dashboard-no-disponible.png) y [error de catálogo con reintento](307-catalogo-no-disponible.png). |
| 601 | [Comparación con GET /auth/me](perfil.md), [administrador](601-tenant_admin.png) y [colaborador](601-colaborador.png). |
| 602 | [Éxito y error de carga](214-resultados.png), [restauración](602-restauracion.png) y [eliminación definitiva](602-eliminacion-definitiva.png). Se verificó que el éxito desaparece y el error sigue visible. |
| 605 | [Login](605-login.png), [registro](605-registro.png) y [menú al navegar a una sección](605-menu-fijo.png). Con movimiento reducido, la animación de entrada de la portada se desactiva. |

Se interceptaron por separado `GET /dashboard` y `GET /plans` con HTTP 503 para reproducir los fallos. Tras retirar el fallo de catálogo, el botón Reintentar volvió a cargar los cuatro planes.
