import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AmountArPipe } from '../../../../../shared/pipes/amount-ar.pipe';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import {
  MonthlyProfitDistribution,
  MonthlyTable,
  RepresentativeProfit,
  RepresentativeProfitBreakdown,
} from '../../../models/treasury.model';
import { PROFITS_HINTS } from '../../../constants/profits-hints.const';
import { ProfitInfoComponent } from '../profit-info/profit-info.component';
import { ProfitMonthDetailsComponent } from '../profit-month-details/profit-month-details.component';

type DistributionFigure =
  | 'netProfit'
  | 'representativesProfit'
  | 'shareholdersPool'
  | 'companyProfit'
  | 'shareholdersProfit'
  | 'distributedProfit';

interface DistributionColumn {
  key: DistributionFigure;
  label: string;
  hint: string;
  /** Hidden when scoped to a single representative (always 0 then). */
  companyOnly?: boolean;
  strong?: boolean;
}

const COLUMNS: readonly DistributionColumn[] = [
  { key: 'netProfit', label: 'صافي الربح', hint: PROFITS_HINTS.distributionNetProfit, strong: true },
  { key: 'representativesProfit', label: 'أرباح المناديب', hint: PROFITS_HINTS.representativesProfit },
  {
    key: 'shareholdersPool',
    label: 'ربح المساهمين قبل نسبة الشركة',
    hint: PROFITS_HINTS.shareholdersPool,
    companyOnly: true,
  },
  { key: 'companyProfit', label: 'أرباح الشركة', hint: PROFITS_HINTS.companyProfit, companyOnly: true },
  {
    key: 'shareholdersProfit',
    label: 'أرباح المساهمين',
    hint: PROFITS_HINTS.shareholdersProfit,
    companyOnly: true,
  },
  { key: 'distributedProfit', label: 'الأرباح الموزعة', hint: PROFITS_HINTS.distributedProfit, strong: true },
];

/** One representative's pair of cells: accrued vs. actually paid out. */
interface RepresentativeCells {
  earned: number;
  paid: number;
}

const NO_REP_ACTIVITY: RepresentativeCells = { earned: 0, paid: 0 };

interface DistributionViewRow {
  row: MonthlyProfitDistribution;
  /** Aligned 1:1 with the `representatives` column groups. */
  reps: RepresentativeCells[];
}

/**
 * "توزيع الأرباح الشهرية". Representative columns are dynamic: one group per
 * representative (treasuries order) with "المستحق" and "المصروف" sub-columns,
 * each cell matched by id — never by index — since a month only lists reps
 * with activity.
 *
 * Every figure is rendered exactly as the API sends it: distributed profit
 * legitimately differs from net profit, so there is no client-side
 * reconciliation.
 *
 * Every row (and the yearly total) opens a breakdown of how its net profit
 * was split.
 */
@Component({
  selector: 'app-monthly-profit-distribution-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AmountArPipe,
    NgTemplateOutlet,
    ModalComponent,
    ProfitInfoComponent,
    ProfitMonthDetailsComponent,
  ],
  templateUrl: './monthly-profit-distribution-table.component.html',
  styleUrl: './monthly-profit-distribution-table.component.scss',
})
export class MonthlyProfitDistributionTableComponent {
  readonly table = input.required<MonthlyTable<MonthlyProfitDistribution>>();
  readonly representatives = input.required<RepresentativeProfit[]>();
  /** False when scoped to a single representative — company/shareholder figures are 0 then. */
  readonly showCompanyFigures = input(true);

  protected readonly hints = PROFITS_HINTS;
  protected readonly selected = signal<MonthlyProfitDistribution | null>(null);

  protected readonly columns = computed(() =>
    this.showCompanyFigures() ? COLUMNS : COLUMNS.filter((c) => !c.companyOnly),
  );

  protected readonly months = computed(() =>
    this.table().months.map((row) => this.toViewRow(row)),
  );

  protected readonly total = computed(() => this.toViewRow(this.table().total));

  /** Fixed columns span both header rows only when the rep sub-header row exists. */
  protected readonly headerRowSpan = computed(() => (this.representatives().length ? 2 : 1));

  protected readonly detailsTitle = computed(() => {
    const row = this.selected();
    if (!row) return '';
    return row === this.table().total
      ? 'تفاصيل توزيع أرباح العام'
      : `تفاصيل توزيع أرباح شهر ${row.monthName}`;
  });

  protected field(key: DistributionFigure): string {
    return `MonthlyProfitDistribution.${key}`;
  }

  private toViewRow(row: MonthlyProfitDistribution): DistributionViewRow {
    const byId = new Map<number, RepresentativeProfitBreakdown>(
      (row.representatives ?? []).map((r) => [r.representativeId, r]),
    );
    return {
      row,
      reps: this.representatives().map((rep) => {
        const r = byId.get(rep.representativeId);
        return r ? { earned: r.earned, paid: r.amount } : NO_REP_ACTIVITY;
      }),
    };
  }
}
