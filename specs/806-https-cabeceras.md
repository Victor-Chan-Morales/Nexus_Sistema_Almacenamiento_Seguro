# SPEC-806: HTTPS Y CABECERAS DE SEGURIDAD

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (seguridad y Compose) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `deploy/on-premises/`, `apps/api/src/main.ts` |
| **Requisitos Vinculados** | RNF-002, RNF-011 |
| **Dependencias** | SPEC-805 |
| **Prioridad** | P1 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Poner un proxy delante del sistema: TLS 1.3, HSTS, CSP y cookies seguras. Sustituye al API Gateway de la propuesta (ADR-008 §1).

## 3. Fuera de Alcance

- Certificados públicos administrados, salvo la configuración documentada.
- Firewall de aplicaciones y límite global de tasa.
- Cambiar el entorno de desarrollo.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Un único punto de entrada
  Entonces solo el proxy publica 80 y 443
  Y /api/* llega a la API y el resto a la web, en el mismo dominio

Escenario 2: TLS
  Entonces una conexión con TLS 1.3 funciona y una con TLS 1.2 se rechaza
  Y HTTP redirige a HTTPS

Escenario 3: Certificados
  Dado NEXUS_DOMAIN con un dominio público → certificado automático
  Dado un host local → certificado interno, con el aviso documentado

Escenario 4: Cabeceras
  Entonces toda respuesta incluye Strict-Transport-Security, Content-Security-Policy,
  X-Content-Type-Options: nosniff, X-Frame-Options: DENY y Referrer-Policy

Escenario 5: CSP funcional
  Entonces la aplicación carga sin violaciones de CSP en login, explorador y página de enlace
  Y no se permiten scripts ni marcos de otros orígenes

Escenario 6: Cookie
  Entonces nexus_refresh sale con Secure, HttpOnly y SameSite=Lax

Escenario 7: IP real
  Con TRUST_PROXY=true, la API obtiene la IP del cliente solo a través del proxy

Escenario 8: Tamaño de subida
  Entonces un archivo de 100 MB se sube sin que el proxy lo rechace

Escenario 9: Logs
  Entonces el proxy no registra el token de /public/share-links/*
```

## 5. Contrato de API

Sin cambios. En producción `NEXT_PUBLIC_API_BASE_URL` pasa a la ruta relativa o al mismo dominio, y `WEB_URL` usa `https`.

## 6. Datos y Esquema

No modifica la base de datos.

## 8. Diseño Técnico

- **Caddy** con imagen fijada por digest (autorizado en ADR-008 §12) y `deploy/on-premises/Caddyfile`.
- `tls { protocols tls1.3 }`. `NEXUS_TLS_MODE`: automático o `internal`.
- **CSP:** Next.js usa scripts en línea. Probar primero con `script-src 'self' 'unsafe-inline'`; **dejar constancia de esa concesión** en el documento de seguridad. Evaluar nonce si el tiempo lo permite. `style-src 'self' 'unsafe-inline'`; `connect-src 'self'`; `frame-ancestors 'none'`; fuentes según `layout.tsx`.
- **`main.ts`:** `app.set('trust proxy', 1)` únicamente si `TRUST_PROXY=true`. No se agrega `helmet`: el proxy aplica las cabeceras en un único punto.
- **Cookie:** ya es `Secure` en producción (ADR-003); verificar `NODE_ENV=production` en Compose.
- **Logs:** formato sin ruta completa para ese prefijo, o con la ruta enmascarada.
- **Riesgo:** una CSP estricta rompe la interfaz; por eso el escenario 5 se comprueba en el navegador.

## 9. Plan de Tareas

- [ ] **T1 (45 min)**: Caddyfile y servicio.
- [ ] **T2 (30 min)**: Quitar puertos directos; variables de la web y la API.
- [ ] **T3 (30 min)**: `trust proxy`.
- [ ] **T4 (15 min)**: Ampliar `smoke-test.sh`.

**Archivos permitidos:** `deploy/on-premises/Caddyfile` (nuevo), `deploy/on-premises/docker-compose.yml`, `.env.template`, `install.sh`, `smoke-test.sh`, `README.md`, `apps/api/src/main.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–4, 6, 9 | Manual con `curl` y `openssl s_client` | Salida en el PR |
| Escenarios 5, 8 | Manual en el navegador | Consola sin violaciones |
| Escenario 7 | Unitaria o manual | Evidencia en el PR |

## 11. Impacto en Documentación

- [ ] `deploy/on-premises/README.md`, `ARCHITECTURE.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
