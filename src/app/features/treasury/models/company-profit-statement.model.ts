export type CompanyProfitVoucherType = 'Receipt' | 'Payment';

/**
 * Origin of a statement line:
 *   - `Voucher`     settlement / capitalisation / manual deposit-withdrawal /
 *                   consolidated company profit share.
 *   - `Transfer`    movement between treasuries.
 *   - `ProfitShare` legacy per-profit company cut — no longer emitted (now
 *                   consolidated into `CompanyProfitShare` vouchers).
 */
export type CompanyProfitEntrySource = 'Voucher' | 'Transfer' | 'ProfitShare';

export type CompanyProfitReferenceType =
  | 'ShareholderProfitCapitalization'
  | 'ProfitDistribution'
  | 'CompanyCapitalAdjustment'
  /** Consolidated voucher of the company's cut of profits on its own balance. */
  | 'CompanyProfitShare'
  | 'TransferIn'
  | 'TransferOut'
  // Forward-compatible: unknown types fall back to the raw value.
  | (string & {});

export interface CompanyProfitEntry {
  id: number;
  voucherNumber: string | null;
  date: string;
  source: CompanyProfitEntrySource;
  voucherType: CompanyProfitVoucherType;
  amount: number;
  balanceAfter: number;
  referenceType: CompanyProfitReferenceType;
  referenceId: number;
  /** Set on `Voucher` lines tied to a shareholder; null otherwise. */
  shareholderId: number | null;
  shareholderName: string | null;
  /**
   * Treasury the money came from / went to — set on manual deposits/withdrawals
   * and on transfers. Null on legacy operations recorded without a treasury.
   */
  counterpartyTreasuryId: number | null;
  counterpartyTreasuryName: string | null;
  capitalClassificationId: number | null;
  capitalClassificationName: string | null;
  /**
   * Rows that can be edited/deleted: manual deposits/withdrawals, every
   * `Payment` voucher, and legacy outgoing transfers (`source = 'Transfer'`).
   */
  isEditable: boolean;
  notes: string | null;
}

export interface CompanyProfitStatement {
  /** Within `fromDate`/`toDate` when filtered, otherwise all-time. */
  totalReceived: number;
  /** Within `fromDate`/`toDate` when filtered, otherwise all-time. */
  totalPaid: number;
  /** `totalReceived − totalPaid` over the same window. */
  netBalance: number;
  /** Live company balance — never affected by the date filter. */
  currentBalance: number;
  /**
   * Balance not accounted for by the full ledger (always computed over every
   * movement). Expected to be 0; anything else signals a data inconsistency.
   */
  unexplainedDifference: number;
  /**
   * Company's own profit share not yet posted to its balance — moves in with
   * the next capitalisation/distribution. Absent on older backend builds.
   */
  pendingProfit?: number;
  entries: {
    pageIndex: number;
    pageSize: number;
    count: number;
    totalPages: number;
    data: CompanyProfitEntry[];
  };
}

export interface CompanyProfitStatementQuery {
  pageIndex?: number;
  pageSize?: number;
  fromDate?: string;
  toDate?: string;
}
