export type PublicPlan = {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  storageGb: number;
  users: number;
  validity: string;
  durationMonths: number | null;
  benefits: string[];
  priceSource: string;
};

const priceSource = "Propuesta mensual en USD, antes de impuestos";

export const PUBLIC_PLANS: PublicPlan[] = [
  {
    id: "demo",
    name: "Demo",
    description: "Prueba el espacio de trabajo de Nexus con capacidad para una organización pequeña.",
    priceUsd: 0,
    storageGb: 5,
    users: 5,
    validity: "Sin vencimiento mientras sea gratuito",
    durationMonths: null,
    benefits: ["5 GB de almacenamiento", "Hasta 5 usuarios", "Funciones básicas del espacio de trabajo"],
    priceSource,
  },
  {
    id: "team",
    name: "Team",
    description: "Almacenamiento seguro para equipos pequeños que comparten archivos de trabajo.",
    priceUsd: 19.99,
    storageGb: 100,
    users: 10,
    validity: "Mensual, renovable",
    durationMonths: 1,
    benefits: ["100 GB de almacenamiento", "Hasta 10 usuarios", "Suscripción mensual renovable"],
    priceSource,
  },
  {
    id: "business",
    name: "Business",
    description: "Más capacidad y espacio para organizaciones en crecimiento.",
    priceUsd: 59.99,
    storageGb: 500,
    users: 30,
    validity: "Mensual, renovable",
    durationMonths: 1,
    benefits: ["500 GB de almacenamiento", "Hasta 30 usuarios", "Suscripción mensual renovable"],
    priceSource,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Capacidad ampliada para organizaciones con mayor volumen.",
    priceUsd: 149.99,
    storageGb: 2000,
    users: 100,
    validity: "Mensual, renovable",
    durationMonths: 1,
    benefits: ["2 TB de almacenamiento", "Hasta 100 usuarios", "Suscripción mensual renovable"],
    priceSource,
  },
];

export function getPlan(planId: string | null | undefined) {
  if (planId === "profesional") return PUBLIC_PLANS.find((plan) => plan.id === "business")!;
  return PUBLIC_PLANS.find((plan) => plan.id === planId) ?? PUBLIC_PLANS[0];
}
