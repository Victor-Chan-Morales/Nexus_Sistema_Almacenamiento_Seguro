/** Presentación de bytes; el contrato siempre transporta bytes. */
export function formatBytes(bytes: number | string | bigint | null | undefined) {
  const numeric = typeof bytes === "number" ? bytes : Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(numeric) / Math.log(1000)));
  const value = numeric / 1000 ** index;
  return `${index === 0 ? value : Number(value.toFixed(value >= 10 ? 0 : 1))} ${units[index]}`;
}

export function formatIsoDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function usagePercent(used: number | string | null | undefined, limit: number | string | null | undefined) {
  const numUsed = Number(used);
  const numLimit = Number(limit);
  if (!Number.isFinite(numLimit) || numLimit <= 0) return 0;
  if (!Number.isFinite(numUsed) || numUsed <= 0) return 0;
  return Math.min(100, Math.round((numUsed / numLimit) * 100));
}

export function formatUsd(amount: number | string | null | undefined): string {
  const numeric = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(numeric)) return "US$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric).replace("$", "US$");
}

export function isExpired(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  return !Number.isNaN(time) && time < now;
}
