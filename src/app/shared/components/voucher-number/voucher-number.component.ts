import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { ToastService } from '../../../core/services/toast.service';

/**
 * Copyable voucher number for tables:
 *
 *   <app-voucher-number [value]="row.voucherNumber" />
 *
 * Voucher numbers are short serials (e.g. `1543`), shown verbatim and copied
 * to the clipboard on click. Renders `—` when empty.
 */
@Component({
  selector: 'app-voucher-number',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (full(); as v) {
      <button
        type="button"
        class="vn"
        [title]="v + ' — اضغط للنسخ'"
        [attr.aria-label]="'رقم السند ' + v + '، اضغط للنسخ'"
        (click)="copy(v); $event.stopPropagation()"
      >
        <span class="vn-text" dir="ltr">{{ v }}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
    } @else {
      <span class="vn-empty">—</span>
    }
  `,
  styles: `
    :host { display: inline-block; max-width: 100%; }
    .vn {
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 100%;
      padding: 2px 7px;
      border: 1px dashed transparent;
      border-radius: var(--r);
      background: var(--bl-l);
      color: var(--bl);
      font: inherit;
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: border-color .15s ease;
    }
    .vn:hover, .vn:focus-visible { border-color: var(--bl); outline: none; }
    .vn-text {
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      unicode-bidi: isolate;
    }
    .vn svg { flex-shrink: 0; opacity: .7; }
    .vn-empty { color: var(--txt3); }
  `,
})
export class VoucherNumberComponent {
  readonly value = input<string | null | undefined>(null);

  private readonly toast = inject(ToastService);

  protected readonly full = computed(() => (this.value() ?? '').trim());

  protected copy(value: string): void {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      this.toast.error('النسخ غير مدعوم في هذا المتصفح');
      return;
    }
    clipboard.writeText(value).then(
      () => this.toast.success('تم نسخ رقم السند'),
      () => this.toast.error('تعذّر النسخ'),
    );
  }
}
