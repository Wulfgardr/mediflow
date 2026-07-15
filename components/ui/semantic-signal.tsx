/* @Codex */

import type { SemanticSignal } from '@/lib/ui-semantic-signal';

const SIGNAL_SURFACE_CLASSES: Record<SemanticSignal, string> = {
  neutral:
    'border-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]',
  success:
    'border-[color:color-mix(in_srgb,var(--lume-signal-success)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]',
  warning:
    'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]',
  critical:
    'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]',
  plum:
    'border-[color:color-mix(in_srgb,var(--lume-signal-plum)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-plum)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-plum)_60%,var(--lume-ink))]',
};

const SIGNAL_TEXT_CLASSES: Record<SemanticSignal, string> = {
  neutral: 'text-[color:var(--lume-ink-muted)]',
  success: 'text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]',
  warning: 'text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]',
  critical: 'text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]',
  plum: 'text-[color:color-mix(in_srgb,var(--lume-signal-plum)_60%,var(--lume-ink))]',
};

export function semanticSignalSurfaceClass(signal: SemanticSignal): string {
  return SIGNAL_SURFACE_CLASSES[signal];
}

export function semanticSignalTextClass(signal: SemanticSignal): string {
  return SIGNAL_TEXT_CLASSES[signal];
}
