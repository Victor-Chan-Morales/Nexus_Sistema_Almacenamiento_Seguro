import { getPlan } from "@/lib/plans";

export const BILLING_DEMO_KEY = "nexus-demo-billing";

export type DemoSubscription = {
  planId: string;
  status: "active" | "expired" | "none";
  startedAt: string;
  expiresAt: string;
  storageUsedGb: number;
  usersUsed: number;
};

export const initialSubscription: DemoSubscription = {
  planId: "business",
  status: "active",
  startedAt: "2026-09-01",
  expiresAt: "2026-10-01",
  storageUsedGb: 35,
  usersUsed: 1,
};

export function readSubscription(): DemoSubscription {
  if (typeof window === "undefined") return initialSubscription;
  try {
    const saved = window.localStorage.getItem(BILLING_DEMO_KEY);
    return saved ? { ...initialSubscription, ...JSON.parse(saved) } : initialSubscription;
  } catch { return initialSubscription; }
}

export function writeSubscription(subscription: DemoSubscription) {
  window.localStorage.setItem(BILLING_DEMO_KEY, JSON.stringify(subscription));
}

export function formatBillingDate(date: string) {
  return new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function activateSubscription(planId: string) {
  const plan = getPlan(planId);
  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + (plan.durationMonths ?? 1));
  const toIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const subscription: DemoSubscription = {
    planId: plan.id,
    status: "active",
    startedAt: toIso(start),
    expiresAt: toIso(end),
    storageUsedGb: 0,
    usersUsed: 1,
  };
  writeSubscription(subscription);
  return subscription;
}
