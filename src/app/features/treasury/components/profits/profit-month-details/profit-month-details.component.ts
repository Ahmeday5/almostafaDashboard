import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AmountArPipe, PercentArPipe } from '../../../../../shared/pipes/amount-ar.pipe';
import {
  MonthlyProfitDistribution,
  RepresentativeProfit,
  ShareholderProfitShare,
} from '../../../models/treasury.model';
import { PROFITS_HINTS } from '../../../constants/profits-hints.const';
import { ProfitInfoComponent } from '../profit-info/profit-info.component';
import {
  ProfitShareholdersTableComponent,
  ShareholderColumn,
} from '../profit-shareholders-table/profit-shareholders-table.component';

const SH = 'MonthlyProfitDistribution.Shareholders';

/** Below this, a percentage/amount gap is rounding noise. */
const EPSILON = 0.005;

const SHAREHOLDER_COLUMNS: readonly ShareholderColumn<ShareholderProfitShare>[] = [
  {
    key: 'contributionPercentage',
    label: 'نسبة المساهمة %',
    kind: 'percent',
    field: `${SH}.ContributionPercentage`,
    hint: PROFITS_HINTS.contributionPercentage,
  },
  { key: 'poolShare', label: 'نصيبه', kind: 'amount', field: `${SH}.PoolShare` },
  {
    key: 'companyPercentage',
    label: 'نسبة الشركة %',
    kind: 'percent',
    field: `${SH}.CompanyPercentage`,
    hint: PROFITS_HINTS.companyPercentage,
  },
  {
    key: 'companyShare',
    label: 'حصة الشركة',
    kind: 'amount',
    field: `${SH}.CompanyShare`,
    hint: PROFITS_HINTS.companyShare,
  },
  {
    key: 'shareholderShare',
    label: 'صافي المساهم',
    kind: 'amount',
    field: `${SH}.ShareholderShare`,
    hint: PROFITS_HINTS.shareholderShare,
  },
];

/**
 * Drill-down of one distribution row (a month, or the yearly total): how the
 * net profit was split between representatives, the company and each
 * shareholder.
 */
@Component({
  selector: 'app-profit-month-details',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AmountArPipe, PercentArPipe, NgTemplateOutlet, ProfitInfoComponent, ProfitShareholdersTableComponent],
  templateUrl: './profit-month-details.component.html',
  styleUrl: './profit-month-details.component.scss',
})
export class ProfitMonthDetailsComponent {
  readonly row = input.required<MonthlyProfitDistribution>();
  /** Column order of the main table, so reps read in the same order here. */
  readonly representatives = input<readonly RepresentativeProfit[]>([]);
  readonly showCompanyFigures = input(true);

  protected readonly hints = PROFITS_HINTS;
  protected readonly shareholderColumns = SHAREHOLDER_COLUMNS;

  protected readonly reps = computed(() => {
    const order = new Map(this.representatives().map((r, i) => [r.representativeId, i]));
    return [...(this.row().representatives ?? [])].sort(
      (a, b) =>
        (order.get(a.representativeId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.representativeId) ?? Number.MAX_SAFE_INTEGER),
    );
  });

  protected readonly repTotals = computed(() =>
    this.reps().reduce(
      (t, r) => ({
        fromContracts: t.fromContracts + r.fromContracts,
        fromRevenues: t.fromRevenues + r.fromRevenues,
        fromExpenses: t.fromExpenses + r.fromExpenses,
      }),
      { fromContracts: 0, fromRevenues: 0, fromExpenses: 0 },
    ),
  );

  /**
   * The company now takes its own slice of the pool, pro rata to its balance:
   * the shareholders' percentages fall short of 100% by exactly that slice.
   * Derived from the row so the gap between the table body and its (backend)
   * totals is explained rather than looking like an error. Null when absent.
   */
  protected readonly companyDirectShare = computed(() => {
    const r = this.row();
    const shareholders = r.shareholders ?? [];
    const pctSum = shareholders.reduce((s, x) => s + (x.contributionPercentage ?? 0), 0);
    const poolSum = shareholders.reduce((s, x) => s + (x.poolShare ?? 0), 0);
    const percentage = Math.max(0, 100 - pctSum);
    const amount = (r.shareholdersPool ?? 0) - poolSum;
    return percentage > EPSILON || Math.abs(amount) > EPSILON ? { percentage, amount } : null;
  });

  /** Pool totals are the backend's own figures — they are what the main table shows. */
  protected readonly shareholderTotals = computed(() => {
    const r = this.row();
    return {
      poolShare: r.shareholdersPool,
      companyShare: r.companyProfit,
      shareholderShare: r.shareholdersProfit,
    };
  });
}
