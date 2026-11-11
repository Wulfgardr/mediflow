/* The clinical timeline must tell "not read yet" apart from "nothing recorded". */
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Checkup, ClinicalEntry } from '../lib/db';

type LoadHook = (url: string, context: unknown, nextLoad: (url: string, context: unknown) => unknown) => unknown;
// Node 24 API, absent from the installed @types/node.
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { load: LoadHook }) => void };

// CSS modules have no Node loader: each class name maps to itself.
registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith('.module.css')) {
            return { format: 'commonjs', shortCircuit: true, source: 'const names = new Proxy({}, { get: (_target, key) => String(key) }); module.exports = { __esModule: true, default: names };' };
        }
        return nextLoad(url, context);
    },
});

type RiverModule = typeof import('./clinical-river-timeline');
// Loaded after the CSS hook is registered.
const river = (): Promise<RiverModule> => import('./clinical-river-timeline');

const EMPTY_TEXT = 'Nessun evento recente';

async function render(props: Parameters<RiverModule['ClinicalRiverTimeline']>[0]): Promise<string> {
    const { ClinicalRiverTimeline } = await river();
    return renderToStaticMarkup(React.createElement(ClinicalRiverTimeline, props));
}

test('diario non ancora letto: la timeline dice che sta leggendo, non che è vuota', async () => {
    const html = await render({ entries: undefined, checkups: [], documentInsights: [] });
    assert.match(html, /role="status"[^>]*>Lettura degli eventi in corso…/u);
    assert.doesNotMatch(html, new RegExp(EMPTY_TEXT, 'u'));
});

test('controlli non ancora letti: nessuno stato vuoto', async () => {
    const html = await render({ entries: [], checkups: undefined, documentInsights: [] });
    assert.match(html, /Lettura degli eventi in corso…/u);
    assert.doesNotMatch(html, new RegExp(EMPTY_TEXT, 'u'));
});

test('controlli illeggibili: errore esplicito, nessuno stato vuoto', async () => {
    const html = await render({ entries: [], checkups: undefined, checkupsUnavailable: true, documentInsights: [] });
    assert.match(html, /role="alert"[^>]*>Impossibile leggere i controlli/u);
    assert.doesNotMatch(html, new RegExp(EMPTY_TEXT, 'u'));
});

test('tutto letto e nulla registrato: stato vuoto', async () => {
    const html = await render({ entries: [], checkups: [], documentInsights: [] });
    assert.match(html, new RegExp(EMPTY_TEXT, 'u'));
    assert.doesNotMatch(html, /Lettura degli eventi in corso/u);
});

test('eventi presenti: elenco senza stato vuoto né lettura', async () => {
    const entry = { id: 'synthetic-entry', patientId: 'synthetic', title: 'Visita sintetica', content: '<p>Testo sintetico</p>',
        type: 'visit', date: new Date('2026-11-01T09:00:00Z') } as unknown as ClinicalEntry;
    const checkup = { id: 'synthetic-checkup', patientId: 'synthetic', title: 'Controllo sintetico',
        date: new Date('2026-12-01T09:00:00Z') } as unknown as Checkup;
    const html = await render({ entries: [entry], checkups: [checkup], documentInsights: [] });
    assert.match(html, /Visita sintetica/u);
    assert.match(html, /Controllo sintetico/u);
    assert.doesNotMatch(html, new RegExp(`${EMPTY_TEXT}|Lettura degli eventi in corso`, 'u'));
});

test('diario illeggibile: errore esplicito, né lettura in corso né stato vuoto', async () => {
    const html = await render({ entries: undefined, checkups: [], entriesUnavailable: true, documentInsights: [] });
    assert.match(html, /role="alert"[^>]*>Impossibile leggere il diario: timeline non disponibile\./u);
    assert.doesNotMatch(html, new RegExp(`${EMPTY_TEXT}|Lettura degli eventi in corso`, 'u'));
});
