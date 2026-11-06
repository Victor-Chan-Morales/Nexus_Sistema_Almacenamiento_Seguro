# SPEC-601 — Comparación con GET /auth/me

Respuesta HTTP 200 para ambas cuentas de demostración. Se verificaron los cuatro campos visibles y la etiqueta asociada al rol.

| Nombre | Correo | Organización | Rol visible | Rol API | Resultado |
|---|---|---|---|---|---|
| Admin Demo | admin@demo.test | Organización Demo | Administrador | tenant_admin | Coincide |
| Colaborador Demo | colaborador@demo.test | Organización Demo | Colaborador | colaborador | Coincide |
