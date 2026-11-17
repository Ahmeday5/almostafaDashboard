/** Row / detail shape returned by `GET /dashboard/shareholders[/{id}]`. */
export interface Shareholder {
  id: number;
  name: string;
  phoneNumber: string;
  address: string;
  /** Capital injected by this shareholder — set once on create, server-managed after. */
  contributedAmount: number;
  /** Server-derived share of total capital (%). */
  ownedPercentage: number;
  companyPercentage: number;
  /** Cumulative profit distributed to this shareholder so far. */
  totalProfitReceived: number;
  /** Profit accrued from installment payments, not yet settled or capitalised. */
  accruedProfit: number;
  capitalTreasuryId: number;
  capitalTreasuryName: string;
  notes: string | null;
  createdAt: string;
  /** True only for the synthetic "الشركة" row (id 0) the list prepends to page 1 — read-only. */
  isCompany?: boolean;
}

/** `GET shareholders/summary`. */
export interface ShareholdersSummary {
  shareholdersCount: number;
  totalShareholdersCapital: number;
  companyBalance: number;
  totalIncludingCompany: number;
}

/** Receipt = إيداع (cash in → balance up), Payment = سحب (cash out → balance down). */
export type CompanyBalanceTransactionType = 'Receipt' | 'Payment';

/**
 * Body of `POST` and `PUT shareholders/company-balance/transactions[/{id}]`.
 *
 * PUT semantics differ per field — callers editing a row must resend the
 * current values for anything they don't intend to change:
 *   - `treasuryId: null`              keeps the stored treasury (POST rejects it).
 *   - `capitalClassificationId: null` CLEARS the classification.
 */
export interface CompanyBalanceTransactionPayload {
  type: CompanyBalanceTransactionType;
  /** Strictly positive. */
  amount: number;
  /** `yyyy-MM-dd`; null lets the server use today. */
  date: string | null;
  treasuryId: number | null;
  capitalClassificationId: number | null;
  notes: string | null;
}

/** `CompanyBalanceTransactionDto` — response of the POST / PUT above. */
export interface CompanyBalanceTransaction {
  id: number;
  voucherNumber: string;
  type: CompanyBalanceTransactionType;
  direction: 'Deposit' | 'Withdrawal';
  amount: number;
  /** Company balance right after this operation. */
  balanceAfter: number;
  date: string;
  /** Null on legacy operations recorded before treasuries were required. */
  treasuryId: number | null;
  treasuryName: string | null;
  capitalClassificationId: number | null;
  capitalClassificationName: string | null;
  notes: string | null;
  userName: string | null;
}

export interface ReconcileTreasuryLine {
  treasuryId?: number;
  treasuryName?: string;
  amount?: number;
  [key: string]: unknown;
}

/** `POST shareholders/company-balance/reconcile-historical` report. */
export interface ReconcileHistoricalReport {
  vouchersReversed: number;
  transactionsRemoved: number;
  totalRestored: number;
  treasuries: ReconcileTreasuryLine[];
}

export interface CreateShareholderPayload {
  name: string;
  phoneNumber: string;
  address: string;
  contributedAmount: number;
  companyPercentage: number;
  capitalTreasuryId: number;
  notes: string;
}

/**
 * PUT /dashboard/shareholders/{id} body. Only descriptive fields are editable;
 * the contribution and its treasury are immutable post-creation.
 */
export interface UpdateShareholderPayload {
  name: string;
  phoneNumber: string;
  address: string;
  companyPercentage: number;
  notes: string;
}

/** Query parameters for `GET /dashboard/shareholders` — `search` matches name or phone. */
export interface ShareholdersQuery {
  pageIndex?: number;
  pageSize?: number;
  search?: string;
}
