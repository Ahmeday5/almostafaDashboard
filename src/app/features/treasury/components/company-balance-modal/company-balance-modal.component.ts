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
import { map } from 'rxjs';

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
import { companyBalanceSourceOf } from '../../constants/company-profit-labels';

type TypeOption = { value: CompanyBalanceTransactionType; label: string };

const TYPE_OPTIONS: readonly TypeOption[] = [
  { value: 'Receipt', label: 'إيداع' },
  { value: 'Payment', label: 'سحب' },
];

const TRANSFER_TYPE_OPTIONS: readonly TypeOption[] = [
  { value: 'Receipt', label: 'تحويل وارد إلى رصيد الشركة' },
  { value: 'Payment', label: 'تحويل صادر من رصيد الشركة' },
];

/**
 * What an edited statement line is:
 *   - `adjustment` manual deposit/withdrawal — treasury optional (null keeps it).
 *   - `transfer`   legacy treasury transfer — treasury = the other side, type = direction.
 *   - `voucher`    any other `Payment` voucher — fixed type, treasury ignored by the API.
 */
type EditKind = 'adjustment' | 'transfer' | 'voucher';

function editKindOf(tx: CompanyProfitEntry): EditKind {
  if (tx.source === 'Transfer') return 'transfer';
  return tx.referenceType === 'CompanyCapitalAdjustment' ? 'adjustment' : 'voucher';
}

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
 * Edit rules depend on the line (see {@link EditKind}). On a deposit/withdrawal
 * the treasury is optional: legacy operations have none, and the API keeps the
 * stored treasury when `treasuryId` is null. The classification is always
 * resent as-is, because a null classification clears it.
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

  /** Raw value — `type` is disabled (and so missing from `value`) on fixed-type vouchers. */
  private readonly draft = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  // ── derived ──
  /** Null = create. */
  protected readonly kind = computed<EditKind | null>(() => {
    const tx = this.transaction();
    return tx ? editKindOf(tx) : null;
  });
  protected readonly isEdit = computed(() => this.kind() !== null);
  protected readonly draftType = computed(() => this.draft().type);

  protected readonly typeOptions = computed(() =>
    this.kind() === 'transfer' ? TRANSFER_TYPE_OPTIONS : TYPE_OPTIONS,
  );
  /** The API ignores the treasury of a non deposit/withdrawal voucher. */
  protected readonly showTreasury = computed(() => this.kind() !== 'voucher');
  protected readonly treasuryRequired = computed(() => {
    const kind = this.kind();
    return kind === null || kind === 'transfer';
  });

  /** Legacy deposits/withdrawals were recorded without a treasury. */
  protected readonly isLegacy = computed(
    () => this.kind() === 'adjustment' && this.transaction()?.counterpartyTreasuryId == null,
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
    const draftEffect = signedAmount(draft.type, Number(draft.amount) || 0);
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
      ? this.service.updateCompanyBalanceTransaction(
          original.id,
          companyBalanceSourceOf(original),
          payload,
        )
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
    const kind = tx ? editKindOf(tx) : null;

    // Mandatory on create and on transfers (the other side); on a
    // deposit/withdrawal edit null means "keep current"; vouchers ignore it.
    const treasury = this.form.controls.treasuryId;
    treasury.setValidators(kind === null || kind === 'transfer' ? Validators.required : null);

    this.form.reset({
      type: tx?.voucherType ?? 'Receipt',
      amount: tx?.amount ?? 0,
      date: tx?.date ? tx.date.slice(0, 10) : todayIsoDate(),
      treasuryId: kind === 'voucher' ? null : (tx?.counterpartyTreasuryId ?? null),
      capitalClassificationId: tx?.capitalClassificationId ?? null,
      notes: tx?.notes ?? '',
    });

    const type = this.form.controls.type;
    if (kind === 'voucher') type.disable();
    else type.enable();
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
