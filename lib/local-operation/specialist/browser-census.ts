import type { BrowserContext, Page, CDPSession } from '@playwright/test';
import { z } from 'zod';
import { unique } from './unique.ts';
import { BrowserInput } from './browser-input.ts';
import { portalAttributes, type ProcedureSnapshot } from '../contract.ts';
import { SYNTHETIC_PORTAL_STYLE } from './prescription.ts';

const controlSchema = z.object({ name: z.string(), value: z.string(), tag: z.string(), type: z.string(), editable: z.boolean(),
    placed: z.boolean(), action: z.string().nullable(), text: z.string() }).strict();
const censusSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('complete'), controls: z.array(controlSchema), unexpected: z.array(z.string()), metadata: z.record(z.string(), z.string()) }).strict(),
    z.object({ status: z.literal('unverifiable') }).strict(),
]);
export type ControlCensus = z.infer<typeof censusSchema>;

const passiveAttributes: Record<string, readonly string[]> = {
    HTML: ['lang'], HEAD: [], META: ['charset'], TITLE: [], STYLE: [], BODY: [], H1: [], P: ['role'],
    MAIN: [...Object.values(portalAttributes), 'data-human'],
    FORM: ['method', 'action'], LABEL: [],
};

async function collectControls(context: BrowserContext, page: Page, token: CensusToken): Promise<ControlCensus> {
    const controls: z.infer<typeof controlSchema>[] = [], unexpected: string[] = [];
    const documents = new Set<string>(), contexts: Record<string, string>[] = [];
    const structure = new Map<string, number[]>();
    const passiveRoles = new Set(['RootWebArea', 'none', 'generic', 'StaticText', 'InlineTextBox', 'heading', 'paragraph', 'main', 'LabelText', 'status']);
    try {
        const pages = context.pages();
        for (const surface of pages) {
            if (surface !== page) unexpected.push('unclassified-document');
            const { session, mainWorlds, worlds } = await token.channel(surface);
            {
                const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
                const { frameTree } = await session.send('Page.getFrameTree');
                const accessibility = new Map<number, { role: string; interactive: boolean }[]>();
                async function visit(node: typeof root, nested: boolean, frameId?: string, native = false): Promise<void> {
                    if (node.nodeType === 9) {
                        if (!frameId || !node.children) throw new Error('unverifiable');
                        documents.add(frameId);
                        const tree = await session.send('Accessibility.getFullAXTree', { frameId });
                        if (!tree.nodes.length) throw new Error('unverifiable');
                        for (const accessible of tree.nodes) {
                            const role = String(accessible.role?.value ?? '');
                            const interactive = !passiveRoles.has(role) || (accessible.properties ?? []).some(property =>
                                ['editable', 'focusable', 'settable'].includes(property.name) && !!property.value.value && role !== 'RootWebArea');
                            if (accessible.backendDOMNodeId) {
                                const entries = accessibility.get(accessible.backendDOMNodeId) ?? [];
                                entries.push({ role, interactive }); accessibility.set(accessible.backendDOMNodeId, entries);
                            }
                            else if (interactive && !accessible.ignored && role !== 'InlineTextBox') unexpected.push('unclassified-accessibility-control');
                        }
                        const mainWorld = unique(mainWorlds.get(frameId) ?? []);
                        if (!worlds.has(frameId)) {
                            const world = await session.send('Page.createIsolatedWorld', { frameId, worldName: 'mediflow-census' });
                            worlds.set(frameId, world.executionContextId);
                        }
                        const styles = await session.send('Runtime.evaluate', { contextId: worlds.get(frameId), returnByValue: true,
                            expression: `(() => { const expected = new CSSStyleSheet(); expected.replaceSync(${JSON.stringify(SYNTHETIC_PORTAL_STYLE)});
                                const rules = sheet => JSON.stringify([...sheet.cssRules].map(rule => rule.cssText));
                                return document.adoptedStyleSheets.length === 0 && document.styleSheets.length === 1
                                    && [...document.styleSheets].every(sheet => !sheet.disabled && !sheet.href && sheet.media.length === 0
                                        && rules(sheet) === rules(expected)); })()` });
                        if (styles.result.value !== true) unexpected.push('unclassified-styles');
                        const window = await session.send('Runtime.evaluate', { expression: 'this', contextId: mainWorld });
                        if (!window.result.objectId) throw new Error('unverifiable');
                        const listeners = await session.send('DOMDebugger.getEventListeners', { objectId: window.result.objectId });
                        if (listeners.listeners.length) unexpected.push('unclassified-interaction');
                        await session.send('Runtime.releaseObject', { objectId: window.result.objectId });

                    }
                    if (node.childNodeCount && node.children?.length !== node.childNodeCount) throw new Error('unverifiable');
                    if (node.frameId && node.frameId !== frameId && node.nodeType === 1 && !node.contentDocument) throw new Error('unverifiable');
                    if ((node.nodeType === 1 || node.nodeType === 9 || node.nodeType === 11) && !native) {
                        const attributes = node.attributes ?? [];
                        if (attributes.length % 2) throw new Error('unverifiable');
                        const attrs = new Map<string, string>();
                        for (let i = 0; i < attributes.length; i += 2) attrs.set(attributes[i]!, attributes[i + 1]!);
                        const { object } = await session.send('DOM.resolveNode', { backendNodeId: node.backendNodeId, executionContextId: frameId ? worlds.get(frameId) : undefined });
                        if (!object.objectId) throw new Error('unverifiable');
                        const mainWorld = unique(frameId ? mainWorlds.get(frameId) ?? [] : []);
                        const listenerObject = await session.send('DOM.resolveNode', { backendNodeId: node.backendNodeId, executionContextId: mainWorld });
                        if (!listenerObject.object.objectId) throw new Error('unverifiable');
                        const listeners = await session.send('DOMDebugger.getEventListeners', { objectId: listenerObject.object.objectId });
                        await session.send('Runtime.releaseObject', { objectId: listenerObject.object.objectId });
                        const allowed = passiveAttributes[node.nodeName];
                        const state = await session.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
                            functionDeclaration: `function() { return this.nodeType === 1 ? {
                                editable: this.isContentEditable === true || ['read-write', 'read-write-plaintext-only'].includes(getComputedStyle(this).webkitUserModify),
                                focusable: this.tabIndex >= 0, attributes: Object.fromEntries([...this.attributes].map(a => [a.name, a.value]))
                            } : { editable: false, focusable: false }; }` });
                        const computed = z.object({ editable: z.boolean(), focusable: z.boolean(), attributes: z.record(z.string(), z.string()).optional() }).parse(state.result.value);
                        const entries = accessibility.get(node.backendNodeId);
                        const ax = entries ? unique(entries) : undefined;
                        if ((node.nodeName === 'INPUT' || node.nodeName === 'BUTTON') && !ax) throw new Error('unverifiable');
                        const interactive = computed.editable || computed.focusable || ax?.interactive;
                        const contracted = (node.nodeName === 'INPUT' && ax?.role === 'textbox' && !computed.editable)
                            || (node.nodeName === 'BUTTON' && ax?.role === 'button' && !computed.editable);
                        if (interactive && !contracted) unexpected.push('unclassified-accessibility-control');
                        if ((node.nodeName === 'INPUT' || node.nodeName === 'BUTTON') && !contracted) unexpected.push('unverifiable-control');
                        if (!nested && surface === page) {
                            const nodes = structure.get(node.nodeName) ?? []; nodes.push(node.backendNodeId); structure.set(node.nodeName, nodes);
                            if (node.nodeName === 'MAIN') contexts.push(computed.attributes ?? {});
                        }
                        if (node.nodeName === 'INPUT' || node.nodeName === 'BUTTON') {
                            const result = await session.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
                                functionDeclaration: `function() { const unique = ${unique.toString()}; const form = this.form; return { name: this.name || '', value: this.value || '', tag: this.tagName,
                                    type: this.type || '', editable: this.isContentEditable === true,
                                    placed: !!form && form === unique([...this.ownerDocument.querySelectorAll('form')])
                                        && form.parentElement === unique([...this.ownerDocument.querySelectorAll('main')])
                                        && form.getAttribute('action') === '/draft' && form.method === 'post',
                                    action: this.getAttribute('formaction'), text: this.textContent.trim() }; }` });
                            const control = controlSchema.parse(result.result.value);
                            controls.push({ ...control, placed: control.placed && !nested && surface === page });
                            const names = node.nodeName === 'INPUT' ? ['name', 'value', 'type', 'form'] : ['type', 'formaction'];
                            if ([...attrs.keys()].some(key => !names.includes(key))) unexpected.push('unclassified-attributes');
                        } else if (node.nodeType === 1 && (!allowed || [...attrs.keys()].some(key => !allowed.includes(key))
                            || (attrs.has('role') && !(node.nodeName === 'P' && attrs.get('role') === 'status')))) {
                            unexpected.push('unclassified-element');
                        }
                        if (listeners.listeners.length) unexpected.push('unclassified-interaction');
                        await session.send('Runtime.releaseObject', { objectId: object.objectId });
                    }
                    for (const child of node.children ?? []) await visit(child, nested, frameId, native);
                    if (node.contentDocument) await visit(node.contentDocument, true, node.frameId);
                    for (const shadow of node.shadowRoots ?? []) await visit(shadow, true, frameId, native || shadow.shadowRootType === 'user-agent');
                    if (node.templateContent) await visit(node.templateContent, true, frameId);
                }
                await visit(root, surface !== page, frameTree.frame.id);
                function verifyFrames(tree: typeof frameTree) {
                    if (tree.frame.unreachableUrl || !documents.has(tree.frame.id)) throw new Error('unverifiable');
                    for (const child of tree.childFrames ?? []) verifyFrames(child);
                }
                verifyFrames(frameTree);
            }
        }
        if (pages.length !== context.pages().length || pages.some(surface => !context.pages().includes(surface)) || !pages.includes(page)) return { status: 'unverifiable' };
        for (const control of controls) {
            unique(controls.filter(candidate => candidate.tag === control.tag
                && (control.tag === 'BUTTON' ? candidate.text === control.text : candidate.name === control.name)));
        }
        for (const tag of ['HTML', 'HEAD', 'META', 'TITLE', 'STYLE', 'BODY', 'MAIN', 'H1', 'FORM']) unique(structure.get(tag) ?? []);
        return censusSchema.parse({ status: 'complete', controls, unexpected, metadata: unique(contexts) });
    } catch { return { status: 'unverifiable' }; }
}


type CensusChannel = { session: CDPSession; mainWorlds: Map<string, number[]>; worlds: Map<string, number> };

const dispatchAuthority: unique symbol = Symbol('census-dispatch');
export type CensusDispatch = { readonly [dispatchAuthority]: true; consume(): void };

export class CensusToken {
    #sessions = new Set<CDPSession>();
    #channels = new Map<Page, CensusChannel>();
    #epoch = 0;
    #observedEpoch = 0;
    #invalid = false;
    #state: 'observed' | 'armed' | 'checking' | 'dispatched' | 'closed' = 'observed';
    #census: ControlCensus = { status: 'unverifiable' };
    #binding?: { expected: string; read(): ProcedureSnapshot };
    readonly #context: BrowserContext;
    readonly #page: Page;
    readonly #input: BrowserInput;
    readonly #newPage = () => { this.#invalid = true; };

    private constructor(context: BrowserContext, page: Page, input: BrowserInput) {
        this.#context = context; this.#page = page; this.#input = input;
        context.on('page', this.#newPage);
    }
    static async capture(context: BrowserContext, page: Page): Promise<CensusToken> {
        const input = await BrowserInput.observe(context, page);
        await input.command('probe');
        const token = new CensusToken(context, page, input);
        token.#observedEpoch = token.#epoch;
        token.#census = await collectControls(context, page, token);
        try { token.assertObserved(); }
        catch { token.#census = { status: 'unverifiable' }; }
        return token;
    }
    get census(): ControlCensus { return this.#census; }
    bind(snapshot: ProcedureSnapshot, read: () => ProcedureSnapshot) {
        this.assertObserved();
        if (this.#state !== 'observed' || this.#binding) throw new Error('unverifiable');
        this.#binding = { expected: JSON.stringify(snapshot), read };
    }
    async channel(surface: Page) {
        const existing = this.#channels.get(surface);
        if (existing) return existing;
        const session = await this.#context.newCDPSession(surface);
        this.own(session, surface);
        const channel: CensusChannel = { session, mainWorlds: new Map<string, number[]>(), worlds: new Map<string, number>() };
        this.#channels.set(surface, channel);
        session.on('Runtime.executionContextCreated', ({ context }) => {
            const frame = z.object({ isDefault: z.boolean(), frameId: z.string() }).safeParse(context.auxData);
            if (frame.success && frame.data.isDefault) {
                const entries = channel.mainWorlds.get(frame.data.frameId) ?? [];
                entries.push(context.id); channel.mainWorlds.set(frame.data.frameId, entries);
            }
        });
        session.on('Runtime.executionContextsCleared', () => { if (this.#state !== 'dispatched') this.#invalid = true; });
        session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
            for (const [frame, entries] of channel.mainWorlds) channel.mainWorlds.set(frame, entries.filter(id => id !== executionContextId));
        });
        await session.send('Runtime.enable');
        await session.send('Page.enable');
        await session.send('DOM.enable');
        await session.send('Accessibility.enable');
        await session.send('CSS.enable');
        session.on('CSS.styleSheetChanged', () => { this.#invalid = true; });
        session.on('CSS.styleSheetAdded', () => { if (this.#state !== 'dispatched') this.#invalid = true; });
        session.on('CSS.styleSheetRemoved', () => { if (this.#state !== 'dispatched') this.#invalid = true; });
        await session.send('Animation.enable');
        await session.send('Animation.setPlaybackRate', { playbackRate: 0 });
        await session.send('Emulation.setScriptExecutionDisabled', { value: true });
        return channel;
    }
    private own(session: CDPSession, surface: Page) {
        this.#sessions.add(session);
        const changed = () => { this.#epoch++; };
        for (const event of ['DOM.attributeModified', 'DOM.attributeRemoved', 'DOM.characterDataModified',
            'DOM.childNodeInserted', 'DOM.childNodeRemoved', 'DOM.childNodeCountUpdated', 'DOM.documentUpdated',
            'DOM.shadowRootPushed', 'DOM.shadowRootPopped', 'DOM.distributedNodesUpdated', 'DOM.inlineStyleInvalidated'] as const) session.on(event, changed);
        session.on('Page.frameAttached', () => { this.#invalid = true; });
        session.on('Page.frameDetached', () => { this.#invalid = true; });
        session.on('Page.frameNavigated', ({ frame }) => { if (this.#state !== 'dispatched' || frame.parentId) this.#invalid = true; });
        session.on('Page.navigatedWithinDocument', () => { this.#invalid = true; });
        session.on('Page.javascriptDialogOpening', () => { this.#invalid = true; });
        session.on('Inspector.detached', () => { this.#invalid = true; });
        surface.on('close', this.#newPage);
    }
    private assertObserved() {
        this.assertHealthy();
        if (this.#state === 'closed' || this.#epoch !== this.#observedEpoch) throw new Error('unverifiable');
    }
    assertHealthy() {
        this.#input.assertHealthy();
        if (this.#invalid || this.#page.isClosed()) throw new Error('unverifiable');
    }
    async act<T>(action: (dispatch: CensusDispatch) => Promise<T>): Promise<T> {
        this.assertObserved();
        if (this.#state !== 'observed' || this.#census.status !== 'complete') throw new Error('unverifiable');
        if (!this.#binding) throw new Error('unverifiable');
        this.#state = 'checking';
        const previous = this.#census;
        this.#census = await collectControls(this.#context, this.#page, this);
        if (this.#census.status !== 'complete' || this.#census.unexpected.length
            || JSON.stringify(this.#census) !== JSON.stringify(previous)) throw new Error('unverifiable');
        const current = this.#binding.read();
        if (JSON.stringify(current) !== this.#binding.expected) throw new Error('unverifiable');
        this.assertObserved();
        if (this.#state !== 'checking') throw new Error('unverifiable');
        this.#state = 'armed';
        const result = await action(Object.freeze({ [dispatchAuthority]: true as const, consume: () => this.dispatch() }));
        this.assertHealthy();
        if (!this.dispatched()) throw new Error('unverifiable');
        return result;
    }
    private dispatched() { return this.#state === 'dispatched'; }
    private dispatch() {
        if (this.#state !== 'armed') throw new Error('unverifiable');
        this.assertObserved();
        if (!this.#binding) throw new Error('unverifiable');
        const current = this.#binding.read();
        if (JSON.stringify(current) !== this.#binding.expected) throw new Error('unverifiable');
        this.#state = 'dispatched';
    }
    async close() {
        this.#state = 'closed';
        this.#context.off('page', this.#newPage);
        for (const surface of this.#context.pages()) surface.off('close', this.#newPage);
        await Promise.allSettled([...this.#sessions].map(async session => {
            try { await session.send('Animation.setPlaybackRate', { playbackRate: 1 }); } finally { await session.detach(); }
        }));
        this.#sessions.clear();
        this.#channels.clear();
    }
}

export async function censusControls(context: BrowserContext, page: Page): Promise<ControlCensus> {
    try {
        const token = await CensusToken.capture(context, page);
        try { return token.census; } finally { await token.close(); }
    } catch { return { status: 'unverifiable' }; }
}
