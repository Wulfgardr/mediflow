export function formatCountLabel(
  count: number,
  singular: string,
  plural: string,
  options?: { template: boolean },
): string {
  const text = count === 1 ? singular : plural;
  const formattedCount = count.toLocaleString('it-IT');
  return options?.template ? text.replaceAll('{count}', formattedCount) : `${formattedCount} ${text}`;
}
