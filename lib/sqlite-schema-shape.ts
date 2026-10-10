import type Database from 'better-sqlite3';

type Row = Record<string, string | number | null>;
type Column = Row & { name: string };
type ForeignKey = Row & { id: number; seq: number };
type Index = { name: string; origin: string; unique: number; partial: number };
type Shape = Record<string, Record<string, unknown>>;

// Bounded schema comparison: unknown SQL remains token-for-token conservative.
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const order = <T>(values: T[]): T[] => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const without = (row: Row, field: string): Row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== field));

export function sqlTokens(sql: string | null): string[] | null {
  if (sql === null) return null;
  const tokens: string[] = [];
  for (let i = 0; i < sql.length;) {
    const rest = sql.slice(i);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { i += whitespace[0].length; continue; }
    if (rest.startsWith('--')) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated SQL comment');
      i = end + 2; continue;
    }
    const start = i;
    const delimiter = sql[i];
    if (['\'', '"', '`', '['].includes(delimiter)) {
      const close = delimiter === '[' ? ']' : delimiter;
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] !== close) continue;
        if (delimiter !== '[' && sql[i] === close) { i++; continue; }
        closed = true; break;
      }
      if (!closed) throw new Error('Unterminated SQL quoted token');
    } else {
      const word = /^[\p{L}\p{N}_$]+/u.exec(rest);
      i += word ? word[0].length : 1;
    }
    tokens.push(sql.slice(start, i));
  }
  return tokens;
}

function declarationName(token: string | undefined) {
  if (token?.startsWith('"')) return token.slice(1, -1).replaceAll('""', '"');
  if (token?.startsWith('`')) return token.slice(1, -1).replaceAll('``', '`');
  if (token?.startsWith('[')) return token.slice(1, -1);
  return token;
}

function tableDefinition(sql: string, name: string, columns: Column[]) {
  const tokens = sqlTokens(sql)!;
  // Only ordinary CREATE TABLE with an explicit column list is decomposed.
  // Virtual tables and every unrecognized form retain their complete tokens.
  if (tokens?.[0]?.toUpperCase() !== 'CREATE' || tokens[1]?.toUpperCase() !== 'TABLE'
      || declarationName(tokens[2]) !== name || tokens[3] !== '(') return { conservative: tokens };
  const clauses: string[][] = []; let start = 4; let depth = 1; let end = -1;
  for (let i = 4; i < tokens.length; i++) {
    if (tokens[i] === '(') depth++;
    if (tokens[i] === ')') depth--;
    if (depth === 0) { clauses.push(tokens.slice(start, i)); end = i; break; }
    if (depth === 1 && tokens[i] === ',') { clauses.push(tokens.slice(start, i)); start = i + 1; }
  }
  if (end < 0) return { conservative: tokens };
  const names = new Set(columns.map(column => column.name));
  const declarations: [string, string[]][] = []; const constraints: string[][] = [];
  for (const clause of clauses) {
    const column = declarationName(clause[0]);
    if (column !== undefined && names.has(column)) declarations.push([column, clause.slice(1)]);
    else constraints.push(clause);
  }
  if (declarations.length !== names.size || new Set(declarations.map(([column]) => column)).size !== names.size)
    return { conservative: tokens };
  // Conflict resolution ordering can be observable: do not reorder such DDL.
  if (tokens.some(token => token.toUpperCase() === 'CONFLICT')) return { conservative: tokens };
  return { columns: order(declarations), constraints, suffix: tokens.slice(end + 1) };
}

export function schemaSnapshot(db: Database.Database): Shape {
  return Object.fromEntries((db.prepare("SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string; sql: string }[]).map(({ name, sql }) => {
    const columns = (db.pragma(`table_xinfo(${quote(name)})`) as Column[]).map(column => without(column, 'cid') as Column).sort((a, b) => a.name.localeCompare(b.name));
    const groups = new Map<number, Row[]>();
    for (const row of db.pragma(`foreign_key_list(${quote(name)})`) as ForeignKey[]) {
      if (!groups.has(row.id)) groups.set(row.id, []);
      groups.get(row.id)!.push(without(row, 'id'));
    }
    const foreignKeys = order([...groups.values()].map(rows => rows.sort((a, b) => Number(a.seq) - Number(b.seq))));
    const indices = order((db.pragma(`index_list(${quote(name)})`) as Index[]).map(index => ({
      name: index.origin === 'c' ? index.name : null, unique: index.unique, origin: index.origin, partial: index.partial,
      definition: index.origin === 'c' ? sqlTokens((db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?").get(index.name) as { sql: string } | undefined)?.sql ?? null) : null,
      columns: (db.pragma(`index_xinfo(${quote(index.name)})`) as (Row & { cid: number })[]).map(column => ({ ...without(column, 'cid'), source: column.cid < 0 ? column.cid : 'column' })),
    })));
    const triggers = (db.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=? ORDER BY name").all(name) as { name: string; sql: string }[]).map(trigger => ({ name: trigger.name, definition: sqlTokens(trigger.sql) }));
    return [name, { columns, foreignKeys, indices, definition: tableDefinition(sql, name, columns), triggers }];
  }));
}

export function schemaDifferences(fresh: Shape, upgraded: Shape) {
  const differences = [];
  for (const table of [...new Set([...Object.keys(fresh), ...Object.keys(upgraded)])].sort()) {
    for (const aspect of ['columns', 'foreignKeys', 'indices', 'definition', 'triggers']) {
      if (JSON.stringify(fresh[table]?.[aspect]) !== JSON.stringify(upgraded[table]?.[aspect]))
        differences.push({ table, aspect, fresh: fresh[table]?.[aspect] ?? null, upgradedOrigin: upgraded[table]?.[aspect] ?? null });
    }
  }
  return differences;
}
