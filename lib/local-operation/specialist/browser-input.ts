import { randomUUID } from 'node:crypto';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { unique } from './unique.ts';

const observers = new WeakMap<Page, Promise<BrowserInput>>();
const events = ['beforeinput', 'input', 'change', 'keydown', 'keyup', 'keypress', 'compositionstart', 'compositionupdate', 'compositionend',
    'pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'auxclick',
    'contextmenu', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'focus', 'blur', 'focusin', 'focusout', 'select', 'selectionchange', 'dragstart', 'drag', 'dragenter', 'dragleave', 'dragover', 'dragend', 'drop', 'copy', 'paste', 'cut'];

export class BrowserInput {
    #invalid = false;
    #ready = false;
    readonly #session: CDPSession;
    readonly #page: Page;
    #contexts = new Set<number>();
    private constructor(session: CDPSession, page: Page) { this.#session = session; this.#page = page; }
    static observe(context: BrowserContext, page: Page): Promise<BrowserInput> {
        let observer = observers.get(page);
        if (!observer) { observer = BrowserInput.attach(context, page); observers.set(page, observer); }
        return observer;
    }
    private static async attach(context: BrowserContext, page: Page) {
        const session = await context.newCDPSession(page), world = `mediflow-input-${randomUUID()}`;
        const observer = new BrowserInput(session, page);
        session.on('Inspector.detached', () => { observer.#invalid = true; });
        session.on('Runtime.executionContextCreated', ({ context }) => { if (context.name === world) observer.#contexts.add(context.id); });
        session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => { observer.#contexts.delete(executionContextId); });
        session.on('Runtime.executionContextsCleared', () => { observer.#contexts.clear(); });
        session.on('Runtime.bindingCalled', event => {
            if (event.name !== 'mediflowInput' || !observer.#contexts.has(event.executionContextId)) { observer.#invalid = true; return; }
            if (event.payload === 'ready') observer.#ready = true;
            else observer.#invalid = true;
        });
        try {
            await session.send('Runtime.enable'); await session.send('Page.enable');
            await session.send('Runtime.addBinding', { name: 'mediflowInput', executionContextName: world });
            const source = `(() => {
                if (globalThis.mediflowExecutor) { mediflowInput('ready'); return; }
                const unique = ${unique.toString()};
                let executing = false, intervened = false;
                const report = () => { if (!executing) { intervened = true; mediflowInput('intervention'); } };
                for (const type of ${JSON.stringify(events)}) window.addEventListener(type, report, true);
                Object.defineProperty(globalThis, 'mediflowExecutor', { value: (command, selector, value) => {
                    if (intervened) throw new Error('unverifiable');
                    if (command === 'probe') { mediflowInput('ready'); return; }
                    if (command === 'read-body') return unique([...document.querySelectorAll('body')]).innerText;
                    const element = unique([...document.querySelectorAll(selector)]);
                    executing = true;
                    try {
                        if (command === 'fill') { element.setAttribute('value', value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }
                        else if (command === 'focus') element.focus();
                        else if (command === 'click') element.click();
                        else throw new Error('unverifiable');
                    } finally { executing = false; }
                } });
                mediflowInput('ready');
            })()`;
            await session.send('Page.addScriptToEvaluateOnNewDocument', { source, worldName: world });
            const { frameTree } = await session.send('Page.getFrameTree');
            const isolated = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: world });
            const result = await session.send('Runtime.evaluate', { contextId: isolated.executionContextId, expression: source });
            if (result.exceptionDetails) throw new Error('unverifiable');
            observer.assertHealthy();
            return observer;
        } catch (error) { observer.#invalid = true; await session.detach().catch(() => {}); throw error; }
    }
    assertHealthy() { if (this.#invalid || !this.#ready || this.#page.isClosed()) throw new Error('unverifiable'); }
    async command(command: 'fill' | 'focus' | 'click' | 'probe' | 'read-body', selector = '', value = ''): Promise<unknown> {
        this.assertHealthy();
        const contextId = unique([...this.#contexts]);
        this.#ready = false;
        const result = await this.#session.send('Runtime.evaluate', { contextId, returnByValue: true,
            expression: `(() => { const value = mediflowExecutor(${JSON.stringify(command)}, ${JSON.stringify(selector)}, ${JSON.stringify(value)}); mediflowExecutor('probe'); return value; })()` });
        if (result.exceptionDetails) throw new Error('unverifiable');
        this.assertHealthy();
        return result.result.value as unknown;
    }
    async readBody(): Promise<string> {
        const value = await this.command('read-body');
        if (typeof value !== 'string') throw new Error('unverifiable');
        return value;
    }
}
