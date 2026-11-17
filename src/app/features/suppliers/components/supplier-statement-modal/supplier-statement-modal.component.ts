import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { CurrencyArPipe } from '../../../../shared/pipes/currency-ar.pipe';
import { BadgeComponent, BadgeType } from '../../../../shared/components/badge/badge.component';
import {
  SearchableSelectComponent,
  SearchableSelectOption,
} from '../../../../shared/components/searchable-select/searchable-select.component';
import { ApiError } from '../../../../core/models/api-response.model';
import { LookupItem } from '../../../../core/models/lookup.model';
import { AuthService } from '../../../../core/services/auth.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { apiErrorToMessage } from '../../../../core/utils/api-error.util';
import { RepsService } from '../../../reps/services/reps.service';
import { SuppliersService } from '../../services/suppliers.service';
import {
  Supplier,
  SupplierStatement,
  SupplierStatementInvoice,
  SupplierStatementInvoiceStatus,
  SupplierStatementPayment,
  SupplierStatementQuery,
} from '../../models/supplier.model';
import { PrintService } from '../../../../core/services/print.service';
import { VoucherNumberComponent } from '../../../../shared/components/voucher-number/voucher-number.component';
import { SupplierPaymentModalComponent } from '../supplier-payment-modal/supplier-payment-modal.component';

const STATUS_BADGE: Record<SupplierStatementInvoiceStatus, BadgeType> = {
  Draft: 'info',
  Pending: 'warn',
  PartiallyPaid: 'warn',
  Paid: 'ok',
  Confirmed: 'ok',
  Cancelled: 'bad',
};

const STATUS_LABEL: Record<SupplierStatementInvoiceStatus, string> = {
  Draft: 'مسودة',
  Pending: 'بانتظار الدفع',
  PartiallyPaid: 'مدفوعة جزئيًا',
  Paid: 'مسددة',
  Confirmed: 'مؤكدة',
  Cancelled: 'ملغاة',
};

/** Label for movements with no representative (recorded by the administration). */
const ADMINISTRATION_LABEL = 'الإدارة';

/** `representativeId` filter value that selects the administration's own movements. */
const ADMINISTRATION_FILTER_ID = 0;

@Component({
  selector: 'app-supplier-statement-modal',
  standalone: true,
  imports: [
    VoucherNumberComponent,
    ReactiveFormsModule,
    DecimalPipe,
    ModalComponent,
    CurrencyArPipe,
    BadgeComponent,
    SearchableSelectComponent,
    SupplierPaymentModalComponent,
  ],
  templateUrl: './supplier-statement-modal.component.html',
  styleUrl: './supplier-statement-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupplierStatementModalComponent {
  // ── inputs ──
  readonly open = input.required<boolean>();
  readonly supplier = input<Supplier | null>(null);

  // ── outputs ──
  readonly closed = output<void>();

  // ── deps ──
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(SuppliersService);
  private readonly printer = inject(PrintService);
  private readonly auth = inject(AuthService);
  private readonly reps = inject(RepsService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  // ── reactive state ──
  protected readonly statement = signal<SupplierStatement | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Set of expanded invoice ids — controls per-row item visibility. */
  protected readonly expanded = signal<ReadonlySet<number>>(new Set<number>());

  // ── direct-payment edit / delete ──
  protected readonly editingPayment = signal<SupplierStatementPayment | null>(null);
  protected readonly deletingPaymentId = signal<number | null>(null);

  // ── representative filter ──
  /**
   * A Representative's statement is always their own account — the filter
   * is for everyone else (admin / management).
   */
  protected readonly canFilterByRepresentative = computed(
    () => !this.auth.hasAnyRole(['Representative']),
  );
  private readonly representatives = signal<LookupItem[]>([]);
  protected readonly representativesLoading = signal(false);
  private representativesRequested = false;

  /** Cleared (null) = every representative. */
  protected readonly representativeOptions = computed<SearchableSelectOption[]>(() => [
    { value: ADMINISTRATION_FILTER_ID, label: ADMINISTRATION_LABEL },
    ...this.representatives().map((r) => ({ value: r.id, label: r.name })),
  ]);

  // ── filter form ──
  protected readonly form = this.fb.nonNullable.group({
    from: [''],
    to: [''],
    includeDrafts: [false],
    representativeId: this.fb.control<number | null>(null),
  });

  // ── derived ──
  protected readonly hasStatement = computed(() => this.statement() !== null);
  protected readonly invoicesCount = computed(
    () => this.statement()?.summary.invoicesCount ?? 0,
  );

  /**
   * Quick health indicator: ratio of paid-to-total. Used to render the
   * progress bar in the hero. Returns 0 when there's nothing purchased
   * (avoids NaN on first load).
   */
  protected readonly paidRatio = computed(() => {
    const s = this.statement()?.summary;
    if (!s || !s.totalPurchases) return 0;
    return Math.min(100, (s.totalPaid / s.totalPurchases) * 100);
  });

  /** Resolved title — supplier name, plus the representative when the statement is scoped to one. */
  protected readonly title = computed(() => {
    const s = this.supplier();
    const base = s ? `كشف حساب — ${s.fullName}` : 'كشف حساب المورد';
    const rep = this.statement()?.representative?.name;
    return rep ? `${base} — المندوب ${rep}` : base;
  });

  // ── debounce ──
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Refetch whenever the modal opens for a different supplier, or
    // when any filter changes (debounced).
    effect(
      () => {
        if (!this.open()) return;
        const supplier = this.supplier();
        if (!supplier) return;

        // First-open reset so reopening for the same supplier doesn't
        // surface a stale draft toggle from the previous session.
        this.resetIfNewSupplier(supplier.id);
        this.ensureRepresentatives();
        this.fetch(supplier.id, this.currentQuery(), false);
      },
      { allowSignalWrites: true },
    );

    // Live debounce on form changes.
    this.form.valueChanges.subscribe(() => {
      const supplier = this.supplier();
      if (!supplier || !this.open()) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.fetch(supplier.id, this.currentQuery(), false);
      }, 300);
    });
  }

  // ─────────── template handlers ───────────

  protected close(): void {
    if (this.editingPayment()) return;
    this.closed.emit();
  }

  protected refresh(): void {
    const supplier = this.supplier();
    if (!supplier) return;
    this.fetch(supplier.id, this.currentQuery(), true);
  }

  protected resetFilters(): void {
    this.form.reset({ from: '', to: '', includeDrafts: false, representativeId: null });
  }

  /** A null representative means the movement was recorded by the administration. */
  protected representativeLabel(name: string | null | undefined): string {
    return name || ADMINISTRATION_LABEL;
  }

  // ─────────── direct payments: edit / delete ───────────

  protected openPaymentEdit(payment: SupplierStatementPayment): void {
    this.editingPayment.set(payment);
  }

  protected closePaymentEdit(): void {
    this.editingPayment.set(null);
  }

  /** Invoice statuses and remaining amounts move with the payment — reload the whole statement. */
  protected onPaymentEdited(): void {
    this.editingPayment.set(null);
    this.refresh();
  }

  protected async confirmPaymentDelete(payment: SupplierStatementPayment): Promise<void> {
    const supplier = this.supplier();
    if (!supplier || this.deletingPaymentId() !== null) return;
    const ok = await this.dialog.confirm({
      title: 'حذف دفعة للمورد',
      message:
        `هل أنت متأكد من حذف الدفعة رقم ${payment.voucherNumber} بمبلغ ` +
        `${payment.amount.toLocaleString('ar-EG')} ج.م؟ سيتم عكس أثرها على الفواتير والخزنة. ` +
        'هذا الإجراء لا يمكن التراجع عنه.',
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (!ok) return;

    this.deletingPaymentId.set(payment.id);
    this.service.deletePayment(supplier.id, payment.id).subscribe({
      next: () => {
        this.deletingPaymentId.set(null);
        this.toast.success('تم حذف الدفعة بنجاح');
        this.refresh();
      },
      error: (err: ApiError) => {
        this.deletingPaymentId.set(null);
        this.toast.error(apiErrorToMessage(err, 'تعذّر حذف الدفعة'));
      },
    });
  }

  protected toggleInvoice(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  protected isExpanded(id: number): boolean {
    return this.expanded().has(id);
  }

  protected statusBadge(status: SupplierStatementInvoiceStatus): BadgeType {
    return STATUS_BADGE[status] ?? 'info';
  }

  protected statusLabel(status: SupplierStatementInvoiceStatus): string {
    return STATUS_LABEL[status] ?? status;
  }

  /** Locale-aware short date — falls back to `—` for missing/invalid input. */
  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /** Sum of `lineTotal` across invoice items. */
  protected itemsTotal(items: { lineTotal: number }[]): number {
    return items.reduce((sum, it) => sum + (it.lineTotal ?? 0), 0);
  }

  /** Sum of standalone payment amounts. */
  protected paymentsTotal(payments: SupplierStatementPayment[]): number {
    return payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  }

  /**
   * Exports the supplier statement as a professional PDF via the unified
   * {@link PrintService}. The statement is already fully loaded in memory
   * (no extra fetch needed), so this is a synchronous render.
   */
  protected print(): void {
    const s = this.statement();
    const supplier = this.supplier();
    if (!s || !supplier) return;

    const meta: Array<{ label: string; value: string }> = [
      { label: 'المورد', value: supplier.fullName },
    ];
    if (s.representative) meta.push({ label: 'المندوب', value: s.representative.name });
    if (s.period.from) meta.push({ label: 'من تاريخ', value: this.formatDate(s.period.from) });
    if (s.period.to)   meta.push({ label: 'إلى تاريخ', value: this.formatDate(s.period.to) });
    meta.push({ label: 'عدد الفواتير', value: String(s.summary.invoicesCount) });
    if (s.summary.standalonePaidTotal > 0) {
      meta.push({
        label: 'مدفوع مباشر',
        value: `${Math.round(s.summary.standalonePaidTotal).toLocaleString('ar-EG')} ج.م`,
      });
    }

    this.printer.print<SupplierStatementInvoice>({
      title: 'كشف حساب المورد',
      subtitle: supplier.fullName,
      meta,
      orientation: 'landscape',
      columns: [
        { key: 'invoiceNumber',  header: 'رقم الفاتورة', align: 'center', bold: true },
        {
          key: 'representativeName',
          header: 'المندوب',
          align: 'center',
          format: (v) => this.representativeLabel(v as string | null | undefined),
        },
        { key: 'invoiceDate',    header: 'تاريخ الفاتورة', align: 'center', format: 'shortDate' },
        { key: 'dueDate',        header: 'الاستحقاق',     align: 'center', format: 'shortDate' },
        {
          key: 'status',
          header: 'الحالة',
          align: 'center',
          format: (v) => STATUS_LABEL[v as SupplierStatementInvoiceStatus] ?? String(v),
        },
        { key: 'subtotal',        header: 'الصافي',      align: 'end', format: 'currency' },
        { key: 'discountAmount',  header: 'الخصم',       align: 'end', format: 'currency' },
        { key: 'taxAmount',       header: 'الضريبة',     align: 'end', format: 'currency' },
        { key: 'totalAmount',     header: 'الإجمالي',    align: 'end', format: 'currency', bold: true },
        { key: 'paidAmount',      header: 'المدفوع',     align: 'end', format: 'currency' },
        { key: 'remainingAmount', header: 'المتبقي',     align: 'end', format: 'currency', bold: true },
      ],
      totals: {
        label: 'الإجمالي',
        labelColSpan: 8,
        cells: [
          `${Math.round(s.summary.totalPurchases).toLocaleString('ar-EG')} ج.م`,
          `${Math.round(s.summary.totalPaid).toLocaleString('ar-EG')} ج.م`,
          `${Math.round(s.summary.totalRemaining).toLocaleString('ar-EG')} ج.م`,
        ],
      },
      rows: s.invoices,
    });
  }

  // ─────────── internals ───────────

  private currentQuery(): SupplierStatementQuery {
    const raw = this.form.getRawValue();
    return {
      from: raw.from?.trim() || undefined,
      to: raw.to?.trim() || undefined,
      includeDrafts: !!raw.includeDrafts,
      representativeId:
        this.canFilterByRepresentative() && raw.representativeId != null
          ? Number(raw.representativeId)
          : null,
    };
  }

  /** Loaded once; a failure (e.g. 403) leaves the filter with "الإدارة" only. */
  private ensureRepresentatives(): void {
    if (this.representativesRequested || !this.canFilterByRepresentative()) return;
    this.representativesRequested = true;
    this.representativesLoading.set(true);
    this.reps
      .lookup()
      .pipe(catchError(() => of<LookupItem[]>([])))
      .subscribe((list) => {
        this.representatives.set(list ?? []);
        this.representativesLoading.set(false);
      });
  }

  /**
   * Track the last-opened supplier so we can wipe filters + cached
   * statement when the user opens the modal for a different one.
   */
  private lastSupplierId: number | null = null;

  private resetIfNewSupplier(id: number): void {
    if (this.lastSupplierId === id) return;
    this.lastSupplierId = id;
    this.statement.set(null);
    this.error.set(null);
    this.expanded.set(new Set<number>());
    this.form.reset(
      { from: '', to: '', includeDrafts: false, representativeId: null },
      { emitEvent: false },
    );
  }

  private fetch(
    supplierId: number,
    query: SupplierStatementQuery,
    force: boolean,
  ): void {
    this.loading.set(true);
    this.error.set(null);

    const stream$ = force
      ? this.service.refreshStatement(supplierId, query)
      : this.service.statement(supplierId, query);

    stream$.subscribe({
      next: (res) => {
        this.statement.set(res);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.statement.set(null);
        this.error.set(err?.message || 'تعذّر تحميل كشف الحساب — حاول مرة أخرى');
        this.loading.set(false);
      },
    });
  }
}
