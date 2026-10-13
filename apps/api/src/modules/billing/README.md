# Módulo Billing

**Dueño:** Anthony.

## Responsabilidades
- Catálogo de planes y características (precio, cuota de almacenamiento, límite de miembros, ubicación).
- Activación de suscripciones simuladas para organizaciones.
- Cálculo y exposición de cuotas máximas de almacenamiento en bytes.

## Comunicación en el Monolito Modular
Exporta `BillingService`. El módulo `FilesModule` inyecta este servicio directamente para validar cuotas antes de aceptar una subida de archivo (`billingService.getStorageLimitBytes(orgId)`), eliminando la necesidad de llamadas HTTP interservicios.
