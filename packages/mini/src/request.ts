/* @Codex */
const PARSE = JSON.parse;

export function hasDuplicateKeys(source: string): boolean {
  const stack: Array<Set<string> | null> = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '{') { stack.push(new Set()); continue; }
    if (character === '[') { stack.push(null); continue; }
    if (character === '}' || character === ']') { stack.pop(); continue; }
    if (character !== '"') continue;
    const start = index;
    for (index += 1; index < source.length; index += 1) {
      if (source[index] === '\\') { index += 1; continue; }
      if (source[index] === '"') break;
    }
    let next = index + 1;
    while (/\s/u.test(source[next] ?? '')) next += 1;
    if (source[next] !== ':') continue;
    const objectKeys = stack[stack.length - 1];
    if (!objectKeys) return true;
    const key = PARSE(source.slice(start, index + 1)) as string;
    if (objectKeys.has(key)) return true;
    objectKeys.add(key);
  }
  return false;
}
