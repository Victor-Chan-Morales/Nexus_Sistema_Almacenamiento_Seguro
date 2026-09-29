# Identidad visual de Nexus

**Fuente de esta guía:** paleta y tipografía compartidas por el equipo para las pantallas existentes.  
**Estado:** referencia base para implementar y comparar con Figma. Las asignaciones semánticas de color son sugeridas; los frames completos todavía deben confirmarse en `docs/FIGMA_MAP.md`.

## Tipografía

- Familia: **Inter**.
- Usar Inter como fuente para texto, títulos, controles, números y marca.
- Pesos recomendados: 400 (regular), 500 (medio), 600 (semibold), 700 (bold) y 800 (extra bold) cuando el diseño lo requiera.
- Evitar introducir una segunda familia tipográfica salvo que un frame aprobado lo indique.
- La web define Inter con una pila local: `Inter, Arial, sans-serif`. Si se decide cargar la fuente desde un proveedor externo, registrar esa decisión y confirmar disponibilidad/licencia en el entorno de despliegue.

## Paleta aprobada por el equipo

| Token CSS | Valor | Uso de referencia |
|---|---|---|
| `--color-purple` | `#53439B` | Morado base; acciones y estados activos |
| `--color-violet` | `#5848A4` | Violeta más claro; variación de marca |
| `--color-purple-deep` | `#4B3C93` | Morado profundo |
| `--color-coral` | `#FA697E` | Acento coral/anaranjado |
| `--color-ice` | `#E1F7FD` | Azul hielo; superficies o acentos claros |
| `--color-gradient-start` | `#23184E` | Inicio del degradado (0%) |
| `--color-gradient-mid` | `#1B1E4D` | Centro del degradado (50%) |
| `--color-gradient-end` | `#12244B` | Final del degradado (100%) |
| `--color-dark` | `#191E2B` | Tono oscuro |
| `--color-dark-mid` | `#1F2637` | Tono intermedio para transiciones |
| `--color-slate` | `#252E42` | Azul pizarra, incluido contenedor de contactos |

Degradado: `linear-gradient(135deg, #23184E 0%, #1B1E4D 50%, #12244B 100%)`. Ajustar el ángulo solo si el frame lo requiere; conservar los tres colores y sus posiciones.

## Reglas de uso

1. Reutilizar tokens CSS de `apps/web/src/app/globals.css`; no volver a escribir hexadecimales en componentes.
2. Los roles de la tabla son una guía semántica, no sustituyen la comparación visual con el mockup.
3. Mantener contraste legible entre texto y fondo; no usar coral para texto pequeño sobre fondo oscuro sin validar contraste.
4. No derivar, sustituir ni agregar tonos de marca sin registrar el cambio y coordinarlo con el responsable de frontend.
5. Añadir un frame/captura a `docs/FIGMA_MAP.md` y validar color, tipografía, estados y jerarquía antes de marcar la pantalla revisada.

## Implementación web

Los valores se exponen como variables `--color-*` y se asignan a variables semánticas existentes (`--brand`, `--accent`, etc.) para que las pantallas puedan usar una referencia compartida. La configuración base de fuente es Inter en toda la web.
