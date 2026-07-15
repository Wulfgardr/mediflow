/* @Codex */

export type SemanticSignal = 'neutral' | 'success' | 'warning' | 'critical' | 'plum';

export type LegacySemanticSignalAlias =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'coral'
  | 'violet'
  | 'muted'
  | 'ink';

export type SemanticSignalInput = SemanticSignal | LegacySemanticSignalAlias;

const LEGACY_SIGNAL_ALIASES: Record<LegacySemanticSignalAlias, SemanticSignal> = {
  blue: 'neutral',
  green: 'success',
  yellow: 'warning',
  coral: 'critical',
  violet: 'plum',
  muted: 'neutral',
  ink: 'neutral',
};

export function resolveSemanticSignal(signal: SemanticSignalInput): SemanticSignal {
  return signal in LEGACY_SIGNAL_ALIASES
    ? LEGACY_SIGNAL_ALIASES[signal as LegacySemanticSignalAlias]
    : signal as SemanticSignal;
}

export type CatalogFreshness = 'fresh' | 'ok' | 'stale' | 'broken' | 'off' | 'n-a';

export function catalogFreshnessSignal(freshness: CatalogFreshness): SemanticSignal {
  switch (freshness) {
    case 'fresh':
      return 'success';
    case 'ok':
    case 'stale':
      return 'warning';
    case 'broken':
      return 'critical';
    case 'off':
    case 'n-a':
      return 'neutral';
    default: {
      const exhaustive: never = freshness;
      return exhaustive;
    }
  }
}

export type TherapySuggestionState = 'active' | 'transition' | 'uncertain' | 'inactive';

export function therapySuggestionStateSignal(state: TherapySuggestionState): SemanticSignal {
  return state === 'transition' ? 'warning' : 'neutral';
}

export type SmartImportReviewState =
  | 'already-present'
  | 'update'
  | 'transition'
  | 'inactive'
  | 'uncertain'
  | 'new';

export function smartImportReviewStateSignal(state: SmartImportReviewState): SemanticSignal {
  return state === 'update' || state === 'transition' ? 'warning' : 'neutral';
}

export function sharedKillSwitchSignal(enabled: boolean): SemanticSignal {
  return enabled ? 'success' : 'critical';
}

export type CatalogMatchStatus = 'unmatched' | 'candidate' | 'matched' | 'manual' | 'not_found';

export function catalogMatchStatusSignal(status: CatalogMatchStatus): SemanticSignal {
  if (status === 'matched') return 'success';
  if (status === 'unmatched' || status === 'not_found') return 'warning';
  return 'neutral';
}

export type AgendaFilter = 'all' | 'urgent' | 'ai' | 'manual';
export type AgendaFilterCategory = Exclude<AgendaFilter, 'all'>;

export function agendaFilterMatches(
  filter: AgendaFilter,
  category: AgendaFilterCategory,
): boolean {
  return filter === 'all' || filter === category;
}
