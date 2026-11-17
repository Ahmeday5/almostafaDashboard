import { BadgeType } from '../../../shared/components/badge/badge.component';
import {
  CompanyProfitEntry,
  CompanyProfitReferenceType,
  CompanyProfitVoucherType,
} from '../models/company-profit-statement.model';
import { CompanyBalanceTransactionSource } from '../models/shareholder.model';
import { CompanyProfitPosting } from '../models/profit-settlement.model';
import { environment } from '../../../../environments/environment';

export const COMPANY_PROFIT_VOUCHER_LABELS: Readonly<
  Record<CompanyProfitVoucherType, string>
> = {
  Receipt: 'قبض',
  Payment: 'صرف',
};

export const COMPANY_PROFIT_VOUCHER_BADGE: Readonly<
  Record<CompanyProfitVoucherType, BadgeType>
> = {
  Receipt: 'ok',
  Payment: 'bad',
};

const REFERENCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  ShareholderProfitCapitalization: 'ترحيل أرباح مساهم',
  ProfitDistribution: 'توزيع أرباح',
  CompanyCapitalAdjustment: 'إيداع / سحب رصيد الشركة',
  CompanyProfitShare: 'نصيب الشركة من الأرباح (مُجمّع)',
  TransferIn: 'تحويل وارد',
  TransferOut: 'تحويل صادر',
};

const REFERENCE_TYPE_BADGE: Readonly<Record<string, BadgeType>> = {
  ShareholderProfitCapitalization: 'purple',
  ProfitDistribution: 'teal',
  CompanyCapitalAdjustment: 'info',
  CompanyProfitShare: 'pink',
  TransferIn: 'ok',
  TransferOut: 'warn',
};

/**
 * `ProfitShare` lines are labelled by direction, not by reference type: a
 * receipt is the company's cut of a profit, a payment is its cut of an
 * expense or the reversal of an earlier profit.
 */
const PROFIT_SHARE_LABELS: Readonly<Record<CompanyProfitVoucherType, string>> = {
  Receipt: 'نصيب الشركة من الأرباح',
  Payment: 'نصيب الشركة من المصروفات / عكس',
};

const PROFIT_SHARE_BADGE: Readonly<Record<CompanyProfitVoucherType, BadgeType>> = {
  Receipt: 'pink',
  Payment: 'warn',
};

const EMPTY = '—';

/** `?source=` for the PUT/DELETE of an editable line — only `Transfer` differs from the default. */
export function companyBalanceSourceOf(entry: CompanyProfitEntry): CompanyBalanceTransactionSource {
  return entry.source === 'Transfer' ? 'Transfer' : 'Voucher';
}

export function isCompanyProfitInflow(type: CompanyProfitVoucherType): boolean {
  return type === 'Receipt';
}

function referenceLabel(entry: CompanyProfitEntry): string {
  if (entry.source === 'ProfitShare') {
    return PROFIT_SHARE_LABELS[entry.voucherType] ?? entry.voucherType;
  }
  return REFERENCE_TYPE_LABELS[entry.referenceType as CompanyProfitReferenceType] ?? entry.referenceType;
}

function referenceBadge(entry: CompanyProfitEntry): BadgeType {
  if (entry.source === 'ProfitShare') {
    return PROFIT_SHARE_BADGE[entry.voucherType] ?? 'info';
  }
  return REFERENCE_TYPE_BADGE[entry.referenceType] ?? 'info';
}

/** Display-ready statement line — resolved once per fetch, not per change detection. */
export interface CompanyProfitEntryRow {
  readonly entry: CompanyProfitEntry;
  /** Stable `track` key — ids are only unique per source. */
  readonly key: string;
  readonly inflow: boolean;
  readonly voucherLabel: string;
  readonly voucherBadge: BadgeType;
  readonly referenceLabel: string;
  readonly referenceBadge: BadgeType;
  readonly shareholder: string;
  /** Legacy deposits/withdrawals have no treasury — rendered as `—`. */
  readonly treasury: string;
  readonly classification: string;
  readonly editable: boolean;
}

export function toCompanyProfitEntryRow(entry: CompanyProfitEntry): CompanyProfitEntryRow {
  return {
    entry,
    key: `${entry.source}:${entry.id}`,
    inflow: isCompanyProfitInflow(entry.voucherType),
    voucherLabel: COMPANY_PROFIT_VOUCHER_LABELS[entry.voucherType] ?? entry.voucherType,
    voucherBadge: COMPANY_PROFIT_VOUCHER_BADGE[entry.voucherType] ?? 'info',
    referenceLabel: referenceLabel(entry),
    referenceBadge: referenceBadge(entry),
    shareholder: entry.shareholderName || EMPTY,
    treasury: entry.counterpartyTreasuryName || EMPTY,
    classification: entry.capitalClassificationName || EMPTY,
    editable: entry.isEditable === true,
  };
}

/** Net amount posted to the company balance by a capitalisation/distribution (negative = loss). */
export function companyPostedTotal(posting: CompanyProfitPosting): number {
  return (posting.totalCompanyShare ?? 0) + (posting.companyOwnProfit ?? 0);
}

/** One-line Arabic summary of the company side of a capitalisation/distribution, for the success toast. */
export function companyPostingSummary(posting: CompanyProfitPosting): string {
  const total = companyPostedTotal(posting);
  const amount = `${Math.round(Math.abs(total)).toLocaleString('ar-SA')} ${environment.currency}`;
  const movement = total < 0 ? `خرج من رصيد الشركة ${amount}` : `دخل رصيد الشركة ${amount}`;
  const voucher = posting.companyVoucherNumber;
  return voucher ? `${movement} (سند رقم ${voucher})` : movement;
}
