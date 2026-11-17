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
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { FormErrorComponent } from '../../../../shared/components/form-error/form-error.component';
import {
  SearchableSelectComponent,
  SearchableSelectOption,
} from '../../../../shared/components/searchable-select/searchable-select.component';
import { VoucherNumberComponent } from '../../../../shared/components/voucher-number/voucher-number.component';
import { CurrencyArPipe } from '../../../../shared/pipes/currency-ar.pipe';
import { todayIsoDate } from '../../../../shared/utils/date-iso.util';
import { ApiError } from '../../../../core/models/api-response.model';
import { ToastService } from '../../../../core/services/toast.service';
import { apiErrorToMessage } from '../../../../core/utils/api-error.util';

import { ShareholdersService } from '../../services/shareholders.service';
import { CapitalClassificationsService } from '../../services/capital-classifications.service';
import {
  CompanyBalanceTransaction,
  CompanyBalanceTransactionPayload,
  CompanyBalanceTransactionType,
} from '../../models/shareholder.model';
import { CompanyProfitEntry } from '../../models/company-profit-statement.model';
import { ShareholderTreasuryLookup } from '../../models/shareholder-treasury-lookup.model';

const TYPE_OPTIONS: ReadonlyArray<{ value: CompanyBalanceTransactionType; label: string }> = [
  { value: 'Receipt', label: 'إيداع' },
  { value: 'Payment', label: 'سحب' },
];

/** Signed effect of an operation on the company balance. */
function signedAmount(type: CompanyBalanceTransactionType, amount: number): number {
  return type === 'Receipt' ? amount : -amount;
}

/**
 * Deposit (`Receipt`) / withdrawal (`Payment`) on the company balance — moves
 * real cash in/out of the selected treasury.
 *
 *   Create: <app-company-balance-modal [open]="o" [balance]="b" (saved)="…" (closed)="…" />
 *   Edit:   same, plus [transaction]="row"   (an `isEditable` statement line)
 *
 * In edit mode the treasury is optional: legacy operations have none, and the
 * API keeps the stored treasury when `treasuryId` is null. The classification
 * is always resent as-is, because a null classification clears it.
 */
@Component({
  selector: 'app-company-balance-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    FormErrorComponent,
    SearchableSelectComponent,
    VoucherNumberComponent,
    CurrencyArPipe,
  ],
  templateUrl: './company-balance-modal.component.html',
})
export class CompanyBalanceModalComponent {
  readonly open = input.required<boolean>();
  /** Current company balance — the base of the live projection. */
  readonly balance = input<number>(0);
  /** Statement line being edited; null = create. */
  readonly transaction = input<CompanyProfitEntry | null>(null);

  readonly closed = output<void>();
  readonly saved = output<CompanyBalanceTransaction>();

  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ShareholdersService);
  private readonly classificationsService = inject(CapitalClassificationsService);
  private readonly toast = inject(ToastService);

  protected readonly typeOptions = TYPE_OPTIONS;

  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);

  // ── lookups (loaded once, on first open) ──
  private readonly treasuries = signal<ShareholderTreasuryLookup[]>([]);
  protected readonly treasuriesLoading = signal(false);
  private readonly classifications = signal<SearchableSelectOption[]>([]);
  protected readonly classificationsLoading = signal(false);
  private lookupsRequested = false;

  protected readonly treasuryOptions = computed<SearchableSelectOption[]>(() =>
    this.treasuries().map((t) => ({
      value: t.id,
      label: t.name,
      hint: t.representativeName ?? undefined,
    })),
  );
  protected readonly classificationOptions = this.classifications.asReadonly();

  protected readonly form = this.fb.group({
    type: this.fb.nonNullable.control<CompanyBalanceTransactionType>('Receipt', Validators.required),
    amount: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0.01)]),
    date: this.fb.nonNullable.control(todayIsoDate(), Validators.required),
    treasuryId: this.fb.control<number | null>(null),
    capitalClassificationId: this.fb.control<number | null>(null),
    notes: this.fb.nonNullable.control(''),
  });

  private readonly draft = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  // ── derived ──
  protected readonly isEdit = computed(() => this.transaction() !== null);
  protected readonly draftType = computed(() => this.draft().type ?? 'Receipt');

  /** Legacy operations were recorded without a treasury. */
  protected readonly isLegacy = computed(
    () => this.isEdit() && this.transaction()?.counterpartyTreasuryId == null,
  );

  protected readonly title = computed(() =>
    this.isEdit() ? 'تعديل عملية على رصيد الشركة' : 'رصيد الشركة — إيداع / سحب',
  );

  /** Balance after this save: drop the edited row's original effect, apply the draft. */
  protected readonly projected = computed(() => {
    const original = this.transaction();
    const originalEffect = original
      ? signedAmount(original.voucherType, original.amount)
      : 0;
    const draft = this.draft();
    const draftEffect = signedAmount(draft.type ?? 'Receipt', Number(draft.amount) || 0);
    return this.balance() - originalEffect + draftEffect;
  });

  protected readonly submitLabel = computed(() => {
    if (this.submitting()) return 'جاري الحفظ...';
    if (this.isEdit()) return 'حفظ التعديل';
    return this.draftType() === 'Receipt' ? 'تسجيل إيداع' : 'تسجيل سحب';
  });

  constructor() {
    effect(
      () => {
        if (!this.open()) return;
        const tx = this.transaction();
        untracked(() => {
          this.submitting.set(false);
          this.serverError.set(null);
          this.resetForm(tx);
          this.ensureLookups();
        });
      },
      { allowSignalWrites: true },
    );
  }

  protected submit(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = this.toPayload();
    const original = this.transaction();
    const request$ = original
      ? this.service.updateCompanyBalanceTransaction(original.id, payload)
      : this.service.createCompanyBalanceTransaction(payload);

    this.serverError.set(null);
    this.submitting.set(true);

    request$.subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.toast.success(this.successMessage(payload.type, !!original));
        this.saved.emit(result);
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        // API messages are already user-facing Arabic — show them verbatim.
        this.serverError.set(apiErrorToMessage(err, 'تعذّر تنفيذ العملية على رصيد الشركة'));
      },
    });
  }

  protected close(): void {
    if (this.submitting()) return;
    this.closed.emit();
  }

  // ─────────── internals ───────────

  private resetForm(tx: CompanyProfitEntry | null): void {
    // Treasury is mandatory on create; on edit null means "keep current".
    const treasury = this.form.controls.treasuryId;
    treasury.setValidators(tx ? null : Validators.required);

    this.form.reset({
      type: tx?.voucherType ?? 'Receipt',
      amount: tx?.amount ?? 0,
      date: tx?.date ? tx.date.slice(0, 10) : todayIsoDate(),
      treasuryId: tx?.counterpartyTreasuryId ?? null,
      capitalClassificationId: tx?.capitalClassificationId ?? null,
      notes: tx?.notes ?? '',
    });
  }

  private toPayload(): CompanyBalanceTransactionPayload {
    const raw = this.form.getRawValue();
    return {
      type: raw.type,
      amount: Number(raw.amount) || 0,
      date: raw.date || null,
      treasuryId: raw.treasuryId != null ? Number(raw.treasuryId) : null,
      capitalClassificationId:
        raw.capitalClassificationId != null ? Number(raw.capitalClassificationId) : null,
      notes: raw.notes.trim() || null,
    };
  }

  private successMessage(type: CompanyBalanceTransactionType, isEdit: boolean): string {
    if (isEdit) return 'تم تعديل العملية على رصيد الشركة بنجاح';
    return type === 'Receipt'
      ? 'تم الإيداع في رصيد الشركة بنجاح'
      : 'تم السحب من رصيد الشركة بنجاح';
  }

  private ensureLookups(): void {
    if (this.lookupsRequested) return;
    this.lookupsRequested = true;

    this.treasuriesLoading.set(true);
    this.service.treasuriesLookup().subscribe({
      next: (list) => {
        this.treasuries.set(list ?? []);
        this.treasuriesLoading.set(false);
      },
      error: () => {
        this.treasuries.set([]);
        this.treasuriesLoading.set(false);
        this.lookupsRequested = false; // allow a retry on next open
      },
    });

    this.classificationsLoading.set(true);
    this.classificationsService.listAll().subscribe({
      next: (list) => {
        this.classifications.set((list ?? []).map((c) => ({ value: c.id, label: c.name })));
        this.classificationsLoading.set(false);
      },
      error: () => {
        this.classifications.set([]);
        this.classificationsLoading.set(false);
      },
    });
  }
}
