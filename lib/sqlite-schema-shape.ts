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

// Closed identifier/list grammar: never reinterpret expression or string tokens.
function identifier(token: string | undefined): string | null {
  const name = declarationName(token);
  return name !== undefined && (token?.startsWith('"') || token?.startsWith('`') || token?.startsWith('[') || /^[A-Za-z_][A-Za-z_0-9]*$/.test(token ?? '')) ? name : null;
}
function identifierList(tokens: string[], start: number): { names: string[]; end: number } | null {
  if (tokens[start] !== '(') return null;
  const names: string[] = []; let i = start + 1;
  for (;;) {
    const name = identifier(tokens[i++]);
    if (name === null) return null;
    names.push(name);
    if (tokens[i] === ')') return { names, end: i + 1 };
    if (tokens[i++] !== ',') return null;
  }
}
function referenceClause(tokens: string[]): unknown | null {
  if (tokens[0]?.toUpperCase() !== 'REFERENCES') return null;
  const table = identifier(tokens[1]); const list = identifierList(tokens, 2);
  if (table === null || !list) return null;
  let i = list.end; const actions: Record<string, string> = { UPDATE: 'NO ACTION', DELETE: 'NO ACTION' };
  const seen = new Set<string>();
  while (i < tokens.length) {
    if (tokens[i++]?.toUpperCase() !== 'ON') return null;
    const event = tokens[i++]?.toUpperCase();
    if (!['UPDATE', 'DELETE'].includes(event) || seen.has(event)) return null;
    seen.add(event);
    let action = tokens[i++]?.toUpperCase();
    if (action === 'NO' || action === 'SET') action += ' ' + tokens[i++]?.toUpperCase();
    if (!['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].includes(action)) return null;
    actions[event] = action;
  }
  return { references: table, columns: list.names, actions };
}
function checkIdentifiers(tokens: string[], columns: Column[]): string[] {
  const names = new Set(columns.map(column => column.name));
  const checkedNames = new Set(['actor_ref', 'attestation_ref', 'attestation_version', 'operation_id',
    'policy_version', 'revocation_generation', 'schema_version', 'status', 'role', 'capability',
    'issuer_ref', 'expires_at', 'activated_at', 'revoked_at', 'created_at', 'updated_at']);
  // Only observed, unambiguous bare column spellings are admitted. Other quoted
  // identifiers, functions, CAST types and collations remain conservative.
  return tokens.map((token, i) => {
    const name = identifier(token);
    if (name === null || !names.has(name) || !checkedNames.has(name)
        || tokens[i + 1] === '(' || ['AS', 'COLLATE'].includes(tokens[i - 1]?.toUpperCase())) return token;
    return name;
  });
}
function normalizeChecks(tokens: string[], columns: Column[]): string[] {
  const result = [...tokens];
  let outer = 0;
  for (let i = 0; i < result.length; i++) {
    if (outer === 0 && result[i].toUpperCase() === 'CHECK' && result[i + 1] === '(') {
      let end = i + 2; let depth = 1;
      for (; end < result.length; end++) {
        if (result[end] === '(') depth++;
        if (result[end] === ')' && --depth === 0) break;
      }
      if (depth !== 0) return tokens;
      result.splice(i + 2, end - i - 2, ...checkIdentifiers(result.slice(i + 2, end), columns));
      i = end; continue;
    }
    if (result[i] === '(') outer++;
    if (result[i] === ')') outer--;
  }
  return result;
}
function columnClause(tokens: string[], columns: Column[]): unknown {
  const normalized = normalizeChecks(tokens, columns);
  if (['TEXT', 'INTEGER'].includes(normalized[0]?.toUpperCase())) normalized[0] = normalized[0].toUpperCase();
  // Exact independent constraints only; no general constraint reordering.
  if (JSON.stringify(normalized) === JSON.stringify(['INTEGER', 'DEFAULT', '1', 'NOT', 'NULL']))
    return ['INTEGER', 'NOT', 'NULL', 'DEFAULT', '1'];
  let depth = 0;
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '(') depth++;
    if (normalized[i] === ')') depth--;
    if (depth === 0 && normalized[i].toUpperCase() === 'REFERENCES') {
      let end = normalized.length; let nested = 0;
      for (let j = i + 1; j < normalized.length; j++) {
        if (normalized[j] === '(') nested++;
        if (normalized[j] === ')') nested--;
        if (nested === 0 && normalized[j].toUpperCase() === 'CHECK') { end = j; break; }
      }
      const reference = referenceClause(normalized.slice(i, end));
      if (reference !== null) return { prefix: normalized.slice(0, i), reference, suffix: normalized.slice(end) };
    }
  }
  return normalized;
}
function constraintClause(input: string[], columns: Column[]): unknown {
  const tokens = normalizeChecks(input, columns);
  if (tokens[0]?.toUpperCase() === 'CONSTRAINT' && identifier(tokens[1]) !== null) {
    return { name: identifier(tokens[1]), constraint: constraintClause(tokens.slice(2), columns) };
  }
  if (tokens[0]?.toUpperCase() === 'PRIMARY' && tokens[1]?.toUpperCase() === 'KEY') {
    const list = identifierList(tokens, 2);
    if (list && list.end === tokens.length && list.names.every(name => columns.some(column => column.name === name))) return { primaryKey: list.names };
  }
  if (tokens[0]?.toUpperCase() !== 'FOREIGN' || tokens[1]?.toUpperCase() !== 'KEY') return tokens;
  const list = identifierList(tokens, 2);
  const reference = list && referenceClause(tokens.slice(list.end));
  return reference ? { foreignKey: list!.names, reference } : tokens;
}
function indexDefinition(sql: string | null, index: string, table: string, columns: Column[]): unknown {
  const tokens = sqlTokens(sql);
  if (!tokens) return null;
  let i = 0;
  if (tokens[i++]?.toUpperCase() !== 'CREATE') return tokens;
  const unique = tokens[i]?.toUpperCase() === 'UNIQUE'; if (unique) i++;
  if (tokens[i++]?.toUpperCase() !== 'INDEX' || identifier(tokens[i++]) !== index
      || tokens[i++]?.toUpperCase() !== 'ON' || identifier(tokens[i++]) !== table || tokens[i++] !== '(') return tokens;
  const keys = [];
  for (;;) {
    const name = identifier(tokens[i++]);
    if (name === null || !columns.some(column => column.name === name)) return tokens;
    let direction = 'ASC';
    if (['ASC', 'DESC'].includes(tokens[i]?.toUpperCase())) direction = tokens[i++].toUpperCase();
    keys.push({ name, direction });
    if (tokens[i] === ')') { i++; break; }
    if (tokens[i++] !== ',') return tokens;
  }
  // Expressions, predicates and COLLATE remain untouched.
  if (i !== tokens.length) return tokens;
  return { index, table, unique, columns: keys };
}
function triggerDefinition(sql: string, name: string, table: string): unknown {
  const tokens = sqlTokens(sql)!;
  // Only the two identifier positions of this simple header are normalized.
  // Event, timing and the entire body (including RAISE literal) remain exact.
  if (tokens[0] === 'CREATE' && tokens[1] === 'TRIGGER' && identifier(tokens[2]) === name
      && tokens[3] === 'BEFORE' && ['UPDATE', 'DELETE'].includes(tokens[4])
      && tokens[5] === 'ON' && identifier(tokens[6]) === table && tokens[7] === 'BEGIN') {
    return { name, table, timing: tokens[3], event: tokens[4], body: tokens.slice(7) };
  }
  return tokens;
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
  const declarations: [string, unknown][] = []; const constraints: unknown[] = [];
  for (const clause of clauses) {
    const column = declarationName(clause[0]);
    if (column !== undefined && names.has(column)) declarations.push([column, columnClause(clause.slice(1), columns)]);
    else constraints.push(constraintClause(clause, columns));
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
      definition: index.origin === 'c' ? indexDefinition((db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?").get(index.name) as { sql: string } | undefined)?.sql ?? null, index.name, name, columns) : null,
      columns: (db.pragma(`index_xinfo(${quote(index.name)})`) as (Row & { cid: number })[]).map(column => ({ ...without(column, 'cid'), source: column.cid < 0 ? column.cid : 'column' })),
    })));
    const triggers = (db.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=? ORDER BY name").all(name) as { name: string; sql: string }[]).map(trigger => ({ name: trigger.name, definition: triggerDefinition(trigger.sql, trigger.name, name) }));
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
