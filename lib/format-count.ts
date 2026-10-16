export function formatCountLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('it-IT')} ${count === 1 ? singular : plural}`;
}
