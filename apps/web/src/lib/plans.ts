export type PublicPlan = {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  storageGb: number;
  users: number | null;
  validity: string;
  durationMonths: number | null;
  benefits: string[];
  priceSource: string;
};

export const PUBLIC_PLANS: PublicPlan[] = [
  {
    id: "demo",
    name: "Demo",
    description: "Explora el espacio de trabajo de Nexus con una capacidad inicial para tu organización.",
    priceUsd: 0,
    storageGb: 5,
    users: 5,
    validity: "Vigencia de demostración",
    durationMonths: null,
    benefits: ["5 GB de almacenamiento", "Hasta 5 usuarios", "Funciones básicas del espacio de trabajo"],
    priceSource: "Valores documentados para la demostración",
  },
  {
    id: "profesional",
    name: "Profesional",
    description: "Una opción de almacenamiento para organizaciones que necesitan más capacidad.",
    priceUsd: 59.99,
    storageGb: 100,
    users: null,
    validity: "12 meses",
    durationMonths: 12,
    benefits: ["100 GB de almacenamiento", "Vigencia anual", "Acceso a las opciones de almacenamiento Nexus"],
    priceSource: "Precio y capacidad de referencia tomados de los mockups",
  },
];

export function getPlan(planId: string | null | undefined) {
  return PUBLIC_PLANS.find((plan) => plan.id === planId) ?? PUBLIC_PLANS[1];
}
