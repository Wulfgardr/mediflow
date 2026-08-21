/* @Codex */

export type VirtualListNavigationKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'j'
  | 'k'
  | 'Home'
  | 'End'
  | 'PageDown'
  | 'PageUp';

export function nextVirtualRowIndex({
  key,
  currentIndex,
  rowCount,
  pageSize,
}: {
  key: VirtualListNavigationKey;
  currentIndex: number;
  rowCount: number;
  pageSize: number;
}): number | null {
  if (rowCount <= 0) return null;
  const current = Math.min(rowCount - 1, Math.max(0, currentIndex));
  const page = Math.max(1, Math.floor(pageSize));

  switch (key) {
    case 'ArrowDown':
    case 'j':
      return Math.min(rowCount - 1, current + 1);
    case 'ArrowUp':
    case 'k':
      return Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return rowCount - 1;
    case 'PageDown':
      return Math.min(rowCount - 1, current + page);
    case 'PageUp':
      return Math.max(0, current - page);
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}
