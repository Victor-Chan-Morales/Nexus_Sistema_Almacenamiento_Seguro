# Propuesta de planes y precios de Nexus

**Estado: aprobada para el catálogo de demostración.** Aprobación del usuario: 2026-09-30. Esto autoriza actualizar la propuesta y las pantallas del prototipo; no autoriza cobros reales ni representa una rentabilidad validada. Los precios son de lista en USD, por mes y antes de impuestos.

## Catálogo propuesto

| Plan | Precio mensual | Almacenamiento incluido | Usuarios incluidos | Vigencia | Enfoque |
|---|---:|---:|---:|---|---|
| Demo | US$0 | 5 GB | 5 | Sin vencimiento mientras se mantenga como plan gratuito | Evaluación y demostración |
| Team | US$19.99 | 100 GB | 10 | Mensual, renovable | Equipos pequeños |
| Business | US$59.99 | 500 GB | 30 | Mensual, renovable | Organizaciones en crecimiento |
| Enterprise | US$149.99 | 2 TB (2,000 GB) | 100 | Mensual, renovable | Organizaciones con mayor volumen |

La vigencia mensual de los planes pagados es una propuesta para hacer predecible la cuota y permitir cambios de escala. La activación y el cobro en el prototipo siguen siendo simulados. No se propone descuento anual hasta conocer costos y comportamiento de clientes.

## Reglas comerciales sugeridas

- La cuota de almacenamiento es el máximo incluido por organización; debe medirse en bytes en el sistema.
- El límite de usuarios cuenta las cuentas activas de la organización.
- No se debe asumir almacenamiento adicional automático ni cobro por excedente. Al alcanzar la cuota, se bloquean nuevas cargas hasta liberar espacio o cambiar a un plan suficiente.
- El cambio a un plan menor solo se permite si el uso confirmado cabe dentro de la nueva cuota; nunca se eliminan archivos automáticamente.
- Los planes Team, Business y Enterprise describen el servicio SaaS administrado. Instalación on-premises, migración, hardware, soporte especializado y requisitos híbridos se cotizan aparte según alcance.
- Impuestos y comisiones no están incluidos en los precios mostrados.

## Justificación

- **Demo sin costo:** permite probar el flujo y reduce la barrera de entrada, con límites de 5 GB y 5 usuarios para contener el uso.
- **Team a US$19.99:** ofrece un punto de entrada pagado para equipos pequeños, con espacio para compartir archivos de trabajo y hasta 10 integrantes.
- **Business a US$59.99:** amplía cinco veces el almacenamiento frente a Team y triplica los usuarios por aproximadamente tres veces el precio, orientándose a organizaciones en crecimiento.
- **Enterprise a US$149.99:** aumenta capacidad y usuarios para equipos mayores y reduce el precio efectivo por GB incluido, premiando el crecimiento.
- El precio efectivo por capacidad es aproximadamente US$0.20/GB-mes en Team, US$0.12 en Business y US$0.075 en Enterprise. Esto facilita explicar la escala, aunque no sustituye el cálculo completo de costos.

Como comprobación parcial, el documento de contexto del proyecto usa US$0.015 por GB-mes de almacenamiento de objetos como benchmark de Cloudflare R2: a cuota completa equivaldría a US$1.50, US$7.50 y US$30 mensuales para Team, Business y Enterprise. Es solo una referencia de costo de bytes; no es el proveedor seleccionado ni incluye cómputo, base de datos, versiones, respaldos, operaciones, correo, monitoreo, soporte, impuestos o comisiones. Por tanto, estos importes no prueban margen ni rentabilidad. Antes de vender, hay que sustituir el benchmark por costos medidos del despliegue elegido.

## Decisiones aprobadas para el prototipo

1. Los cuatro nombres, precios, cuotas y límites de usuarios de la tabla.
2. Vigencia mensual renovable para planes pagados y Demo sin vencimiento.
3. Bloqueo de nuevas cargas al llegar a la cuota, sin sobrecargo automático.
4. Cotización separada de on-premises, híbrido, migraciones y soporte especializado.
5. Moneda USD, precios antes de impuestos y ausencia de descuento anual inicial.

Al aprobarse, el catálogo debe actualizarse de forma consistente en Billing, la interfaz pública, el detalle de planes y las pantallas de suscripción. Mientras siga pendiente, no se debe presentar como tarifa aprobada ni sustituir en producción el mockup existente.
