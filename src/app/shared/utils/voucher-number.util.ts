const SHORT_MAX_LEN = 12;
const HEAD_LEN = 6;
const TAIL_LEN = 6;
const ELLIPSIS = '…';

/**
 * Compact form of a voucher number for dense tables. Voucher numbers are long
 * and the distinguishing parts are the type prefix and the trailing sequence,
 * so we keep both ends and drop the middle:
 *
 *   `CCA-20261116-000123`   → `CCA-…-000123`
 *   `3f2a9b1c-...-9e8d7c6b` → `3f2a9b-…-7c6b`
 *   `V-0012`                → `V-0012` (already short)
 *
 * Always pair the short form with the full value (tooltip / copy).
 */
export function shortenVoucherNumber(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (v.length <= SHORT_MAX_LEN) return v;

  const segments = v.split('-').filter(Boolean);
  if (segments.length >= 2) {
    const head = segments[0].slice(0, HEAD_LEN);
    const tail = segments[segments.length - 1].slice(-TAIL_LEN);
    return `${head}-${ELLIPSIS}-${tail}`;
  }
  return `${v.slice(0, HEAD_LEN)}${ELLIPSIS}${v.slice(-TAIL_LEN)}`;
}
