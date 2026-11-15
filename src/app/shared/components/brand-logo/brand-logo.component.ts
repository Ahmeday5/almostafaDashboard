import {
  ChangeDetectionStrategy,
  Component,
  computed,
  Input,
  signal,
} from '@angular/core';

/**
 * Visual variant of the brand mark.
 *
 * - `color`   — full-color emblem on a deep teal squircle (use on light surfaces).
 * - `mono`    — single-color emblem that inherits `currentColor` (toolbars, dense UI).
 * - `inverse` — light emblem tuned for dark surfaces.
 */
export type BrandLogoVariant = 'color' | 'mono' | 'inverse';

/**
 * Canonical "المصطفى" brand mark — the single source of truth for the logo.
 *
 * The emblem is a geometric monogram: an upward finance curve (growth / cash flow)
 * nested inside a rounded container, with an accent node that reads as a seed of value.
 * Rendered as inline SVG so it stays crisp at any size and themeable via CSS.
 *
 * @example
 * <app-brand-logo [size]="40" />                      <!-- emblem only -->
 * <app-brand-logo [size]="34" [showWordmark]="true" /><!-- emblem + wordmark -->
 * <app-brand-logo variant="mono" />                   <!-- inherits currentColor -->
 */
@Component({
  selector: 'app-brand-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="brand-logo" [class.brand-logo--with-text]="showWordmark">
      <svg
        class="brand-logo__emblem"
        [attr.width]="size"
        [attr.height]="size"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        [attr.aria-label]="ariaLabel"
      >
        @if (variant === 'color') {
          <defs>
            <linearGradient
              [attr.id]="containerGradientId"
              x1="4"
              y1="2"
              x2="44"
              y2="46"
              gradientUnits="userSpaceOnUse"
            >
              <stop stop-color="#1aa5b8" />
              <stop offset="1" stop-color="#084a55" />
            </linearGradient>
            <linearGradient
              [attr.id]="accentGradientId"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop stop-color="#9ff0f6" />
              <stop offset="1" stop-color="#5fd6e2" />
            </linearGradient>
          </defs>
        }

        <!-- Container: rounded "squircle" -->
        <rect
          x="2"
          y="2"
          width="44"
          height="44"
          rx="13"
          [attr.fill]="containerFill()"
          [attr.stroke]="containerStroke()"
          [attr.stroke-width]="containerStroke() ? 1.5 : 0"
        />

        <!-- Monogram: upward finance curve forming the "م" bowl -->
        <path
          d="M13 33V19.4c0-2.26 2.77-3.34 4.3-1.68L24 25l6.7-7.28c1.53-1.66 4.3-.58 4.3 1.68V33"
          [attr.stroke]="markColor()"
          stroke-width="3.1"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <!-- Accent node: seed of value -->
        <circle cx="35" cy="15" r="2.9" [attr.fill]="accentFill()" />
      </svg>

      @if (showWordmark) {
        <span class="brand-logo__wordmark" [attr.data-variant]="variant">
          {{ brandName }}
        </span>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        line-height: 0;
      }

      .brand-logo {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }

      .brand-logo__emblem {
        display: block;
        flex-shrink: 0;
      }

      .brand-logo--with-text .brand-logo__emblem {
        filter: drop-shadow(0 2px 6px rgba(8, 74, 85, 0.28));
      }

      .brand-logo__wordmark {
        font-family: var(--font-arabic, inherit);
        font-weight: 800;
        font-size: 18px;
        line-height: 1;
        letter-spacing: 0.2px;
        white-space: nowrap;
      }

      /* Color + mono wordmarks sit on light surfaces: brand-tinted. */
      .brand-logo__wordmark[data-variant='color'],
      .brand-logo__wordmark[data-variant='mono'] {
        background: linear-gradient(90deg, var(--bl-d, #084a55), var(--bl, #127a8a));
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        color: var(--bl-d, #084a55);
      }

      /* Inverse wordmark sits on dark surfaces. */
      .brand-logo__wordmark[data-variant='inverse'] {
        color: #f3fbfc;
      }
    `,
  ],
})
export class BrandLogoComponent {
  /** Emblem edge length in pixels. */
  @Input() size = 40;

  /** Whether to render the wordmark next to the emblem. */
  @Input() showWordmark = false;

  /** Color treatment — see {@link BrandLogoVariant}. */
  @Input()
  set variant(value: BrandLogoVariant) {
    this._variant.set(value);
  }
  get variant(): BrandLogoVariant {
    return this._variant();
  }
  private readonly _variant = signal<BrandLogoVariant>('color');

  /** Canonical brand name, used for the wordmark and accessible label. */
  protected readonly brandName = 'المصطفى';

  protected readonly ariaLabel = `${this.brandName} — الشعار`;

  /**
   * SVG gradient ids must be unique per instance so multiple logos on one page
   * don't collide (a known footgun with shared `<defs>` ids).
   */
  private static nextId = 0;
  private readonly uid = BrandLogoComponent.nextId++;
  protected readonly containerGradientId = `brand-container-${this.uid}`;
  protected readonly accentGradientId = `brand-accent-${this.uid}`;

  protected readonly containerFill = computed(() => {
    switch (this._variant()) {
      case 'color':
        return `url(#${this.containerGradientId})`;
      case 'inverse':
        return 'rgba(255, 255, 255, 0.12)';
      case 'mono':
      default:
        return 'none';
    }
  });

  protected readonly containerStroke = computed(() =>
    this._variant() === 'mono' ? 'currentColor' : null,
  );

  protected readonly markColor = computed(() => {
    switch (this._variant()) {
      case 'color':
      case 'inverse':
        return '#ffffff';
      case 'mono':
      default:
        return 'currentColor';
    }
  });

  protected readonly accentFill = computed(() => {
    switch (this._variant()) {
      case 'color':
        return `url(#${this.accentGradientId})`;
      case 'inverse':
        return '#7fe3ec';
      case 'mono':
      default:
        return 'currentColor';
    }
  });
}
