import type { BrowserContext, Page } from '@playwright/test';
import { z } from 'zod';

const controlSchema = z.object({ name: z.string(), value: z.string(), tag: z.string(), type: z.string(), editable: z.boolean(),
    placed: z.boolean(), action: z.string().nullable(), text: z.string() }).strict();
const censusSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('complete'), controls: z.array(controlSchema), unexpected: z.array(z.string()) }).strict(),
    z.object({ status: z.literal('unverifiable') }).strict(),
]);
export type ControlCensus = z.infer<typeof censusSchema>;

const passiveAttributes: Record<string, readonly string[]> = {
    HTML: ['lang'], HEAD: [], META: ['charset'], TITLE: [], STYLE: [], BODY: [], H1: [], P: ['role'],
    MAIN: ['data-patient', 'data-practice', 'data-account', 'data-ui', 'data-human'],
    FORM: ['method', 'action'], LABEL: [],
};

export async function censusControls(context: BrowserContext, page: Page): Promise<ControlCensus> {
    const controls: z.infer<typeof controlSchema>[] = [], unexpected: string[] = [];
    const documents = new Set<string>();
    try {
        const pages = context.pages();
        for (const surface of pages) {
            if (surface !== page) unexpected.push('unclassified-document');
            const session = await context.newCDPSession(surface);
            try {
                const mainWorlds = new Map<string, number>();
                session.on('Runtime.executionContextCreated', ({ context }) => {
                    const frame = z.object({ isDefault: z.boolean(), frameId: z.string() }).safeParse(context.auxData);
                    if (frame.success && frame.data.isDefault) mainWorlds.set(frame.data.frameId, context.id);
                });
                await session.send('Runtime.enable');
                await session.send('Emulation.setScriptExecutionDisabled', { value: true });
                const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
                const { frameTree } = await session.send('Page.getFrameTree');
                const worlds = new Map<string, number>();
                async function visit(node: typeof root, nested: boolean, frameId?: string, native = false): Promise<void> {
                    if (node.nodeType === 9) {
                        if (!frameId || !node.children) throw new Error('unverifiable');
                        documents.add(frameId);
                        const mainWorld = mainWorlds.get(frameId);
                        if (!mainWorld) throw new Error('unverifiable');
                        const window = await session.send('Runtime.evaluate', { expression: 'this', contextId: mainWorld });
                        if (!window.result.objectId) throw new Error('unverifiable');
                        const listeners = await session.send('DOMDebugger.getEventListeners', { objectId: window.result.objectId });
                        if (listeners.listeners.length) unexpected.push('unclassified-interaction');
                        await session.send('Runtime.releaseObject', { objectId: window.result.objectId });
                        const world = await session.send('Page.createIsolatedWorld', { frameId, worldName: 'mediflow-census' });
                        worlds.set(frameId, world.executionContextId);
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
                        const mainWorld = frameId ? mainWorlds.get(frameId) : undefined;
                        if (!mainWorld) throw new Error('unverifiable');
                        const listenerObject = await session.send('DOM.resolveNode', { backendNodeId: node.backendNodeId, executionContextId: mainWorld });
                        if (!listenerObject.object.objectId) throw new Error('unverifiable');
                        const listeners = await session.send('DOMDebugger.getEventListeners', { objectId: listenerObject.object.objectId });
                        await session.send('Runtime.releaseObject', { objectId: listenerObject.object.objectId });
                        const allowed = passiveAttributes[node.nodeName];
                        if (node.nodeName === 'INPUT' || node.nodeName === 'BUTTON') {
                            const result = await session.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
                                functionDeclaration: `function() { const form = this.form; return { name: this.name || '', value: this.value || '', tag: this.tagName,
                                    type: this.type || '', editable: this.isContentEditable === true,
                                    placed: !!form && form.parentElement?.tagName === 'MAIN' && this.ownerDocument.querySelectorAll('form').length === 1
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
            } finally { await session.detach(); }
        }
        if (pages.length !== context.pages().length || pages.some(surface => !context.pages().includes(surface)) || !pages.includes(page)) return { status: 'unverifiable' };
        return censusSchema.parse({ status: 'complete', controls, unexpected });
    } catch { return { status: 'unverifiable' }; }
}
