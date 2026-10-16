// Single-line CSV cells are deliberate: a physical row is always the reported row.
export function parseProstheticsLine(line: string, delimiter = ','): string[] | null {
    const cells: string[] = [];
    let cell = '', quoted = false, closed = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
            if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') { quoted = false; closed = true; }
            else cell += c;
        } else if (c === delimiter) { cells.push(cell); cell = ''; closed = false; }
        else if (c === '"' && cell === '' && !closed) quoted = true;
        else if (c === '"' || closed) return null;
        else cell += c;
        if (cell.length > 2000 || cells.length > 100) return null;
    }
    if (quoted) return null;
    cells.push(cell);
    return cells;
}

