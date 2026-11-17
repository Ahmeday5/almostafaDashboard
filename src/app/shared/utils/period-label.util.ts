/** A date-range filter as sent to the API (`YYYY-MM-DD`, empty = open-ended). */
export interface DatePeriod {
  readonly fromDate?: string | null;
  readonly toDate?: string | null;
}

/** `YYYY-MM-DD` → `D/M/YYYY`, parsed by hand so no timezone can shift the day. */
function formatIsoDay(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? `${d}/${m}/${y}` : value;
}

/**
 * Human label of an applied period, or `null` when unfiltered:
 *   both  → `من 1/11/2026 إلى 16/11/2026`
 *   from  → `من 1/11/2026`
 *   to    → `حتى 16/11/2026`
 */
export function describePeriod(period: DatePeriod | null | undefined): string | null {
  const from = period?.fromDate?.trim();
  const to = period?.toDate?.trim();
  if (from && to) return `من ${formatIsoDay(from)} إلى ${formatIsoDay(to)}`;
  if (from) return `من ${formatIsoDay(from)}`;
  if (to) return `حتى ${formatIsoDay(to)}`;
  return null;
}

/** `صافي الرصيد` → `صافي الرصيد من … إلى …` when a period is applied. */
export function withPeriod(label: string, period: DatePeriod | null | undefined): string {
  const suffix = describePeriod(period);
  return suffix ? `${label} ${suffix}` : label;
}
