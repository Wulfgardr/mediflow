import { isProstheticsDate, isProstheticsText, type ProstheticsSnapshot } from './prosthetics-catalog-contract.ts';

function object(value: unknown, keys: string[]): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export function isProstheticsSnapshot(value: unknown): value is ProstheticsSnapshot {
    if (!object(value, ['entryId','code','codeSystem','description','source','documents','revision']) || !isProstheticsText(value.entryId, 2048)
        || !isProstheticsText(value.code) || !isProstheticsText(value.codeSystem) || !isProstheticsText(value.description, 2000) || !sha(value.revision)) return false;
    const source = value.source;
    if (!object(source, ['id','name','authority','scope','version','date','sha256','notes']) || !isProstheticsText(source.id, 1024)
        || ['name','authority','scope','version'].some(key => !isProstheticsText(source[key])) || !sha(source.sha256)
        || (source.date !== null && !isProstheticsDate(source.date)) || typeof source.notes !== 'string'
        || source.notes.length > 2000 || /[\u0000-\u001f\u007f]/u.test(source.notes)) return false;
    if (!Array.isArray(value.documents) || value.documents.length > 1000) return false;
    const ids = new Set<string>();
    for (const doc of value.documents) {
        if (!object(doc, ['id','sourceId','name','sha256','size','page']) || typeof doc.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(doc.id)
            || ids.has(doc.id) || doc.sourceId !== source.id || !isProstheticsText(doc.name, 300) || !sha(doc.sha256)
            || typeof doc.size !== 'number' || !Number.isSafeInteger(doc.size) || doc.size < 1 || doc.size > 25 * 1024 * 1024
            || (doc.page !== null && !isProstheticsText(doc.page, 100))) return false;
        ids.add(doc.id);
    }
    return true;
}
