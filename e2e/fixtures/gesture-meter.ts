// Injected in every document. Counts DOM events, never Playwright operations.
export function installGestureMeter() {
  const storageKey = 'mediflow-synthetic-gesture-meter';
  type Gesture = { kind: string; key?: string; shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean; target: string; dataOra?: true; timeStamp: number; responseMs: number | null };
  type Reading = { active: boolean; gesti: number; clic: number; tasti: number; comandi: number; events: Gesture[] };
  const empty = (): Reading => ({ active: false, gesti: 0, clic: 0, tasti: 0, comandi: 0, events: [] });
  let state: Reading = JSON.parse(sessionStorage.getItem(storageKey) || 'null') || empty();
  const persist = () => sessionStorage.setItem(storageKey, JSON.stringify(state));
  const gesture = (event: MouseEvent | KeyboardEvent) => {
    if (!state.active) return;
    const target = event.target as HTMLElement;
    const reading = state;
    const item: Gesture = { kind: event.type, ...(event instanceof KeyboardEvent ? { key: event.key, shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey } : {}),
      target: target.getAttribute?.('aria-label') || target.id || target.tagName,
      // I segmenti interni di un campo data e ora nativo dipendono dal sistema (AM/PM con l'orologio a dodici ore).
      ...(event.type === 'keydown' && target.matches?.('input[type=datetime-local], input[type=date], input[type=time], input[type=month], input[type=week]') ? { dataOra: true as const } : {}),
      timeStamp: event.timeStamp, responseMs: null };
    reading.gesti++;
    if (event.type === 'click') reading.clic++;
    else reading.comandi++;
    reading.events.push(item);
    persist();
    requestAnimationFrame(() => {
      item.responseMs = Math.max(0, Math.round(performance.now() - event.timeStamp));
      if (state === reading) persist();
    });
  };
  document.addEventListener('click', event => { if (event.detail > 0) gesture(event); }, true);
  document.addEventListener('keydown', event => {
    if (['Shift', 'Meta', 'Control', 'Alt', 'CapsLock', 'Dead', 'AltGraph'].includes(event.key) || event.isComposing) return;
    const target = event.target as HTMLElement;
    // The production diary uses contenteditable with role=textbox, unlike the prototype's textarea.
    const inText = target.matches?.('textarea, input:not([type=radio]):not([type=range]):not([type=checkbox])') || target.isContentEditable;
    const writes = !event.metaKey && !event.ctrlKey && !event.altKey && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete');
    if (inText && writes) { if (state.active) { state.tasti++; persist(); } }
    else gesture(event);
  }, true);
  Object.assign(window, { gestureMeter: {
    start() { state = { ...empty(), active: true }; persist(); },
    async stop() {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      state.active = false; persist(); return state;
    },
  } });
}

export type GestureReading = {
  active: boolean; gesti: number; clic: number; tasti: number; comandi: number;
  events: Array<{ kind: string; key?: string; shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean; target: string; dataOra?: true; timeStamp: number; responseMs: number | null }>;
};

declare global {
  interface Window { gestureMeter: { start(): void; stop(): Promise<GestureReading> } }
}
