# Evidencia SPEC-212: renombrar en el explorador

Capturas tomadas en el navegador contra la web en desarrollo (`npm run dev:web`) y la API local, con una base de datos de desarrollo aislada y la cuenta demo de administrador.

| Archivo | Qué muestra |
|---|---|
| `01-renombrar-lista.jpg` | `/archivos`: filas de archivo y carpeta con las acciones "Renombrar" y "Mover a…". |
| `02-renombrar-dialogo.jpg` | Diálogo "Renombrar archivo" con el nombre actual seleccionado. |
| `03-renombrar-exito.jpg` | La fila muestra el nombre nuevo y aparece el aviso "Se renombró a «informe-final-212.txt».". |
| `04-renombrar-error-nombre-ocupado.jpg` | Nombre ocupado: "Ya existe un archivo con ese nombre en esta carpeta." dentro del diálogo, y la fila no cambia. |
| `05-solo-lectura-equipo.jpg` | Colaborador con nivel `read` en un Drive de equipo: aviso "Solo lectura" y, en las filas, solo "Abrir", "Descargar" y "Versiones". No aparecen "Renombrar" ni "Mover a…". |

Las capturas de mover están en `RESUMEN-mover.md`, en la PR de mover.
