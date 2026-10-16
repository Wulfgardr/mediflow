'use client';

import { PROSTHETICS_COLUMNS, type ProstheticsMapping } from '@/lib/reference-data/prosthetics-catalog-contract';
import type { ProstheticsSource } from '@/lib/reference-data/prosthetics-catalog-client';
import { parseProstheticsLine } from '@/lib/reference-data/prosthetics-csv-line';

export function ProstheticsImportFields({ source, disabled, onChange }: { source: ProstheticsSource; disabled: boolean; onChange: (source: ProstheticsSource) => void }) {
    const delimiter = source.options?.mapping?.delimiter ?? ',';
    const header = parseProstheticsLine(new TextDecoder().decode(Uint8Array.from(atob(source.base64), c => c.charCodeAt(0))).split(/\r?\n/u)[0], delimiter) ?? [];
    const columns = source.options?.mapping?.columns ?? Object.fromEntries(PROSTHETICS_COLUMNS.map((k, i) => [k, header[i] === k ? i : -1])) as ProstheticsMapping['columns'];
    function changeMapping(nextDelimiter: ',' | ';', nextColumns: ProstheticsMapping['columns']) {
        onChange({ ...source, options: { ...source.options, mapping: { delimiter: nextDelimiter, columns: nextColumns } } });
    }
    const details = source.options?.sourceDetails ?? { authority: '', date: null, notes: '' };
    return <fieldset disabled={disabled} className="space-y-3 text-sm">
        <legend className="font-semibold">Colonne e metadati della fonte</legend>
        <p>Per file Excel, esporta prima il foglio in CSV UTF-8. Ogni file deve contenere anche le colonne delle date, eventualmente vuote.</p>
        <label className="block">Separatore<select className="input-field" value={delimiter} onChange={e => changeMapping(e.target.value as ',' | ';', Object.fromEntries(PROSTHETICS_COLUMNS.map((k, i) => [k, i])) as ProstheticsMapping['columns'])}><option value=",">Virgola</option><option value=";">Punto e virgola</option></select></label>
        <div className="grid gap-3 sm:grid-cols-2">{PROSTHETICS_COLUMNS.map(key => <label key={key}>{key.replaceAll('_', ' ')}
            <select className="input-field" value={columns[key]} onChange={e => changeMapping(delimiter, { ...columns, [key]: Number(e.target.value) })}>
                <option value={-1}>Scegli colonna</option>{header.map((name, i) => <option key={i} value={i}>{i + 1}. {name}</option>)}
            </select></label>)}</div>
        <label className="block">Ente (facoltativo, altrimenti ambito del file)<input className="input-field" value={details.authority} maxLength={200} onChange={e => onChange({ ...source, options: { ...source.options, sourceDetails: { ...details, authority: e.target.value } } })} /></label>
        <label className="block">Data della fonte (facoltativa)<input type="date" className="input-field" value={details.date ?? ''} onChange={e => onChange({ ...source, options: { ...source.options, sourceDetails: { ...details, date: e.target.value || null } } })} /></label>
        <label className="block">Note della fonte<input className="input-field" value={details.notes} maxLength={2000} onChange={e => onChange({ ...source, options: { ...source.options, sourceDetails: { ...details, notes: e.target.value } } })} /></label>
    </fieldset>;
}
