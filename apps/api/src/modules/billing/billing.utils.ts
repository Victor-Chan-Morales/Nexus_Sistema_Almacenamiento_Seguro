import { Plan } from './entities/plan.entity';

/**
 * Retorna el precio del plan convertido de centavos a dólares USD con precisión decimal.
 */
export function priceUsd(plan: Partial<Plan> | null | undefined): number {
  return ((plan?.priceCents ?? 0) || 0) / 100;
}

/**
 * Retorna la fecha dada o actual en formato ISO solo-día UTC ('YYYY-MM-DD').
 */
export function todayUtcDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
