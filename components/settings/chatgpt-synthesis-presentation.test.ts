/* @Codex — pure presentation/source checks; NOT a runtime or browser substitute. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { ProductCode, ProductOperation, ProductSnapshot, ProductState } from '../../lib/chatgpt-product/product-contract';
import { presentSynthesisStatus, presentSynthesisNotice, qualificationCopy } from './chatgpt-synthesis-presentation.ts';

const source = (path: string) => readFileSync(resolve(path), 'utf8');
// This presenter reads state only; no controller, transport, host or authority fake.
const state = (value: ProductState) => ({ state: value }) as ProductSnapshot;

test('all product states have distinct readable copy without raw state tokens', () => {
    const states: ProductState[] = ['held', 'needs_consent', 'consented', 'starting', 'awaiting_login', 'verifying', 'connected', 'ready', 'generating', 'completed', 'canceled', 'error'];
    const titles = states.map(value => presentSynthesisStatus(state(value), null).title);
    assert.equal(new Set(titles).size, states.length);
    for (const value of states) {
        const copy = presentSynthesisStatus(state(value), null);
        assert.ok(copy.title.length > 0 && copy.next.length > 0);
        assert.ok(!copy.title.includes(value), value);
        assert.deepEqual(presentSynthesisStatus(state(value), 'status'), copy, 'local polls do not replace the useful state');
    }
});

test('account, dedicated access and model availability are not conflated', () => {
    assert.deepEqual(presentSynthesisStatus(state('connected'), null), {
        title: 'Accesso alla prova verificato', next: 'Leggi i modelli disponibili prima di scegliere.',
    });
    assert.deepEqual(presentSynthesisStatus(state('ready'), null), {
        title: 'Modelli disponibili', next: 'Scegli modello e livello di ragionamento, poi genera.',
    });
    assert.match(presentSynthesisStatus(state('completed'), null).next, /uso clinico resta sospeso/);
    assert.match(source('app/settings/ai/chatgpt/page.tsx'), /Account collegato non significa modello pronto/);
});

test('each pending action has readable copy and status absence never claims readiness', () => {
    const operations: ProductOperation[] = ['consent', 'login/start', 'login/complete', 'login/cancel', 'read', 'models', 'generate', 'cancel', 'logout'];
    for (const operation of operations) {
        const copy = presentSynthesisStatus(null, operation);
        assert.ok(copy.title && copy.next);
        assert.ok(!copy.title.includes(operation));
        assert.match(copy.next, /Nessun nuovo tentativo automatico/);
    }
    assert.equal(presentSynthesisStatus(null, null).title, 'Stato non disponibile');
    assert.equal(presentSynthesisStatus(state('held'), null).title, 'Prova sospesa');
});

test('qualification and notices keep blockers explicit, including future bounded notices', () => {
    assert.equal(qualificationCopy.unqualified, 'Verifiche della postazione incomplete.');
    assert.match(qualificationCopy.unsupported, /non supporta/);
    assert.match(qualificationCopy.qualified, /uso clinico resta sospeso/);
    const codes: ProductCode[] = ['unqualified_boundary', 'session_expired', 'not_connected', 'unsupported_account', 'busy', 'canceled', 'revoked', 'quota_exhausted', 'limits_unavailable', 'catalog_stale', 'model_unavailable', 'model_mismatch', 'invalid_request', 'invalid_output', 'tool_use_denied', 'timeout', 'process_exited', 'protocol_error', 'upstream_error', 'consent_required', 'consent_stale', 'invalid_state', 'login_pending', 'login_failed', 'login_expired', 'logout_unconfirmed', 'unauthorized', 'forbidden', 'method_not_allowed'];
    for (const code of codes) {
        assert.equal(typeof presentSynthesisNotice(code), 'string');
        assert.ok(presentSynthesisNotice(code).length > 10);
    }
    assert.match(presentSynthesisNotice('login_pending'), /Completa prima l’accesso ufficiale/);
    assert.match(presentSynthesisNotice('logout_unconfirmed'), /non è confermato/);
    for (const future of ['future_notice', '__proto__']) {
        assert.match(presentSynthesisNotice(future as ProductCode), /richiede attenzione/);
    }
});

test('page and existing account card provide explicit local navigation without prefetch', () => {
    const page = source('app/settings/ai/chatgpt/page.tsx');
    const card = source('components/settings/chatgpt-account-card.tsx');
    const panel = source('components/settings/chatgpt-synthesis-panel.tsx');
    assert.match(page, /<Link href="\/settings\/ai\/fabric" prefetch=\{false\}/);
    assert.match(card, /<Link href="\/settings\/ai\/chatgpt" prefetch=\{false\}/);
    assert.match(panel, /<Link href="\/settings\/ai\/modelli" prefetch=\{false\}/);
    assert.match(page, /SETTINGS_SECONDARY_BUTTON_CLASS/);
    assert.match(card, /Apri prova OpenAI · solo dati demo/);
    assert.match(source('app/settings/ai/fabric/page.tsx'), /<ChatGptAccountPanel/);
    assert.match(source('app/settings/ai/modelli/page.tsx'), /<ChatGptAccountPanel/);
    assert.ok(exactRouteExists('fabric') && exactRouteExists('modelli'));
});
function exactRouteExists(name: string): boolean {
    return source(`app/settings/ai/${name}/page.tsx`).length > 0;
}

test('technical disclosures default closed; visible state, errors and blockers precede them', () => {
    const panel = source('components/settings/chatgpt-synthesis-panel.tsx');
    assert.doesNotMatch(panel, /<details[^>]*\bopen(?:\s|=|>)/);
    assert.doesNotMatch(source('app/settings/ai/chatgpt/page.tsx'), /<details[^>]*\bopen(?:\s|=|>)/);
    const firstDisclosure = panel.indexOf('<details');
    for (const visible of ['data-testid="synthesis-state"', '{view.error}', 'presentSynthesisNotice(snapshot.notice)', 'qualificationCopy[snapshot.qualification.state]', 'La pulizia della prova precedente non è confermata', 'Lo scollegamento remoto non è confermato']) {
        assert.ok(panel.indexOf(visible) > 0 && panel.indexOf(visible) < firstDisclosure, visible);
    }
    assert.ok(panel.indexOf('Fonti demo da inviare') < panel.indexOf('Autorizzo accesso dedicato'));
    const resultStart = panel.indexOf('data-testid="synthesis-result"');
    const result = panel.slice(resultStart, panel.indexOf('</article> : null}', resultStart));
    assert.match(result, /Modello utilizzato/);
    assert.match(result, /snapshot.result.provenance.effort/);
    assert.match(result, /citation.sourceId/);
    assert.match(result, /citation.quote/);
    assert.match(result, /Scritture cliniche:/);
    assert.doesNotMatch(result, /<details/);
});

test('Lume geometry and typography are scoped; no decorative status styling or fieldset frames', () => {
    const css = source('components/settings/chatgpt-synthesis-panel.module.css');
    const pageCss = source('app/settings/ai/chatgpt/page.module.css');
    for (const text of [css, pageCss]) {
        assert.match(text, /var\(--lume-radius-control, 12px\)/);
        assert.match(text, /var\(--lume-control-height, 44px\)/);
        assert.match(text, /var\(--lume-font-sans/);
        assert.match(text, /font-size: 1rem/);
        assert.match(text, /focus-visible/);
        assert.match(text, /prefers-reduced-motion/);
        assert.doesNotMatch(text, /border-left|linear-gradient|#[a-f\d]{3,8}\b|\.badge|\.pill/i);
    }
    assert.match(css, /var\(--lume-radius-card, 12px\)/);
    assert.match(css, /\.panel fieldset \{[^}]*border: 0;/);
    assert.match(css, /\.panel \.consent \{[^}]*min-height: max\(44px, var\(--lume-control-height, 44px\)\)/);
});

test('canonical browser safeguards remain present and target visible translated state', () => {
    const spec = source('e2e/chatgpt-synthesis-product.spec.ts');
    assert.equal(spec.match(/getByTestId\('chatgpt-synthesis-panel'\)\.getByRole\('alert'\)/g)?.length, 3);
    assert.doesNotMatch(spec, /\.first\(/);
    assert.match(spec, /url.pathname !== '\/_next\/hmr'/);
    assert.match(spec, /url.pathname === '\/_next\/hmr'/);
    assert.match(spec, /index < 3/);
    assert.match(spec, /held \? 'Prova sospesa' : 'In attesa del tuo consenso'/);
    assert.match(spec, /getByText\('Verifiche della postazione incomplete\.[^']+', \{ exact: true \}\)\)\.toBeVisible\(\)/);
    assert.match(spec, /getByTestId\('synthesis-state'\)\)\.toContainText\('In attesa dell’accesso OpenAI'\)/);
    assert.match(spec, /assert\.equal\(\(await pending\)\.status\(\), 409\)/);
});
