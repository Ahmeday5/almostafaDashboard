import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AmountArPipe } from '../../../../../shared/pipes/amount-ar.pipe';
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

interface KeyFigure {
  label: string;
  value: number;
  strong?: boolean;
}

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
 * Drill-down of one distribution row (a month, or the yearly total): the
 * representatives', company's and each shareholder's figures. Every figure
 * is the API's own — the pool, company and shareholder totals are
 * independent server values, so nothing here adds or subtracts them.
 */
@Component({
  selector: 'app-profit-month-details',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AmountArPipe, NgTemplateOutlet, ProfitInfoComponent, ProfitShareholdersTableComponent],
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

  /** Headline figures of the row, straight from the API. */
  protected readonly keyFigures = computed<readonly KeyFigure[]>(() => {
    const r = this.row();
    return [
      { label: 'صافي الربح', value: r.netProfit, strong: true },
      { label: 'أرباح المناديب', value: r.representativesProfit },
      { label: 'ربح المساهمين قبل نسبة الشركة', value: r.shareholdersPool },
      { label: 'أرباح الشركة', value: r.companyProfit },
      { label: 'أرباح المساهمين', value: r.shareholdersProfit },
      { label: 'الأرباح الموزعة', value: r.distributedProfit, strong: true },
    ];
  });

  /** Column sums of the listed reps — a plain footer, not a reconciliation. */
  protected readonly repTotals = computed(() =>
    this.reps().reduce(
      (t, r) => ({
        fromContracts: t.fromContracts + r.fromContracts,
        fromRevenues: t.fromRevenues + r.fromRevenues,
        fromExpenses: t.fromExpenses + r.fromExpenses,
        earned: t.earned + r.earned,
        paid: t.paid + r.amount,
      }),
      { fromContracts: 0, fromRevenues: 0, fromExpenses: 0, earned: 0, paid: 0 },
    ),
  );

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
