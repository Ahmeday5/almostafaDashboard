import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { PaginationComponent } from '../../../../shared/components/pagination/pagination.component';
import { BadgeComponent } from '../../../../shared/components/badge/badge.component';
import { VoucherNumberComponent } from '../../../../shared/components/voucher-number/voucher-number.component';
import { CurrencyArPipe } from '../../../../shared/pipes/currency-ar.pipe';
import { DateArPipe } from '../../../../shared/pipes/date-ar.pipe';
import { AmountArPipe } from '../../../../shared/pipes/amount-ar.pipe';
import { DatePeriod, withPeriod } from '../../../../shared/utils/period-label.util';
import { ApiError } from '../../../../core/models/api-response.model';
import { ToastService } from '../../../../core/services/toast.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { apiErrorToMessage } from '../../../../core/utils/api-error.util';
import { environment } from '../../../../../environments/environment';

import { ShareholdersService } from '../../services/shareholders.service';
import {
  CompanyProfitEntry,
  CompanyProfitStatement,
  CompanyProfitStatementQuery,
} from '../../models/company-profit-statement.model';
import { toCompanyProfitEntryRow } from '../../constants/company-profit-labels';
import { CompanyBalanceModalComponent } from '../company-balance-modal/company-balance-modal.component';

const DEFAULT_PAGE_SIZE = 10;

/** Half a piaster — anything smaller is floating-point/rounding noise, not a real gap. */
const DIFFERENCE_TOLERANCE = 0.005;

/**
 * Company balance ledger: settlements, capitalisations, profit shares,
 * treasury transfers and manual deposits/withdrawals. Manual lines
 * (`isEditable`) can be edited/deleted in place.
 */
@Component({
  selector: 'app-company-profit-statement-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    PaginationComponent,
    BadgeComponent,
    VoucherNumberComponent,
    CompanyBalanceModalComponent,
    CurrencyArPipe,
    AmountArPipe,
    DateArPipe,
  ],
  templateUrl: './company-profit-statement-modal.component.html',
  styleUrl: './company-profit-statement-modal.component.scss',
})
export class CompanyProfitStatementModalComponent {
  readonly open = input.required<boolean>();
  readonly closed = output<void>();

  private readonly service = inject(ShareholdersService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  protected readonly statement = signal<CompanyProfitStatement | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  // ── date filters (draft — applied on explicit click) ──
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');
  /** Period the displayed totals were computed for (set from the request, not the draft). */
  private readonly appliedPeriod = signal<DatePeriod | null>(null);

  // ── pagination ──
  protected readonly pageIndex = signal(1);
  protected readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  protected readonly count = signal(0);
  protected readonly totalPages = signal(0);

  // ── row edit / delete ──
  protected readonly editing = signal<CompanyProfitEntry | null>(null);
  protected readonly deletingId = signal<number | null>(null);

  // ── derived ──
  protected readonly currency = environment.currency;

  protected readonly rows = computed(() =>
    (this.statement()?.entries.data ?? []).map(toCompanyProfitEntryRow),
  );

  /** Non-null only when the backend reports a balance gap worth surfacing. */
  protected readonly unexplainedDifference = computed(() => {
    const diff = this.statement()?.unexplainedDifference ?? 0;
    return Math.abs(diff) >= DIFFERENCE_TOLERANCE ? diff : null;
  });

  protected readonly hasFilters = computed(() => !!this.fromDate() || !!this.toDate());

  protected readonly netBalanceLabel = computed(() =>
    withPeriod('صافي الرصيد', this.appliedPeriod()),
  );

  constructor() {
    // Refetch on every open: the ledger moves with every profit recorded
    // anywhere in the system, so a stale copy from a previous open is wrong.
    effect(
      () => {
        if (!this.open()) return;
        untracked(() => this.fetch(this.pageIndex(), this.pageSize(), false));
      },
      { allowSignalWrites: true },
    );
  }

  protected close(): void {
    if (this.editing()) return;
    this.closed.emit();
  }

  protected refresh(): void {
    this.fetch(this.pageIndex(), this.pageSize(), true);
  }

  protected applyDates(): void {
    this.pageIndex.set(1);
    this.fetch(1, this.pageSize(), true);
  }

  protected clearDates(): void {
    this.fromDate.set('');
    this.toDate.set('');
    this.applyDates();
  }

  protected onPageChange(page: number): void {
    this.pageIndex.set(page);
    this.fetch(page, this.pageSize(), false);
  }

  protected onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.pageIndex.set(1);
    this.fetch(1, size, false);
  }

  // ─────────── edit ───────────

  protected openEdit(entry: CompanyProfitEntry): void {
    this.editing.set(entry);
  }

  protected closeEdit(): void {
    this.editing.set(null);
  }

  protected onEdited(): void {
    this.editing.set(null);
    this.afterWrite();
  }

  // ─────────── delete ───────────

  protected async confirmDelete(entry: CompanyProfitEntry): Promise<void> {
    if (this.deletingId() !== null) return;
    const kind = entry.voucherType === 'Receipt' ? 'الإيداع' : 'السحب';
    const ok = await this.dialog.confirm({
      title: 'حذف عملية على رصيد الشركة',
      message:
        `هل أنت متأكد من حذف عملية ${kind} بمبلغ ${entry.amount.toLocaleString('ar-EG')} ${this.currency}؟ ` +
        'سيتم عكس أثرها على رصيد الشركة وعلى الخزينة. هذا الإجراء لا يمكن التراجع عنه.',
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (!ok) return;

    this.deletingId.set(entry.id);
    this.service.deleteCompanyBalanceTransaction(entry.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.toast.success('تم حذف العملية وعكس أثرها بنجاح');
        // Step back if we just emptied the last page.
        if (this.rows().length === 1 && this.pageIndex() > 1) {
          this.pageIndex.update((p) => p - 1);
        }
        this.afterWrite();
      },
      error: (err: ApiError) => {
        this.deletingId.set(null);
        this.toast.error(apiErrorToMessage(err, 'تعذّر حذف العملية'));
      },
    });
  }

  // ─────────── internals ───────────

  /**
   * Writes invalidate the `shareholder` + `treasur` cache scopes, which makes
   * the shareholders page reload its list and summary on its own
   * (`onInvalidate`); this modal only has to reload the ledger itself.
   */
  private afterWrite(): void {
    this.fetch(this.pageIndex(), this.pageSize(), true);
  }

  private fetch(pageIndex: number, pageSize: number, force: boolean): void {
    this.loading.set(true);
    this.error.set(null);

    const query: CompanyProfitStatementQuery = {
      pageIndex,
      pageSize,
      fromDate: this.fromDate() || undefined,
      toDate: this.toDate() || undefined,
    };

    const stream$ = force
      ? this.service.refreshCompanyProfitStatement(query)
      : this.service.getCompanyProfitStatement(query);

    stream$.subscribe({
      next: (res) => {
        this.statement.set(res);
        this.appliedPeriod.set({ fromDate: query.fromDate, toDate: query.toDate });
        this.count.set(res.entries.count ?? 0);
        this.totalPages.set(res.entries.totalPages ?? 0);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        const msg = apiErrorToMessage(err, 'تعذّر تحميل كشف الحساب');
        this.statement.set(null);
        this.count.set(0);
        this.totalPages.set(0);
        this.error.set(msg);
        this.loading.set(false);
        this.toast.error(msg);
      },
    });
  }
}
