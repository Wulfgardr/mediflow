/* @Codex: test-only, passive observation of one real keyboard activation.
 * No synthetic events, focus repair, input activation or application hooks.
 * The returned object remains in the page; snapshots contain booleans/counts only.
 */
export type ChooserState = Readonly<{
  rootConnected: boolean; rootVisible: boolean; rootEnabled: boolean; rootIdle: boolean;
  rootTabbable: boolean; rootFocused: boolean; inputCount: number;
  sameInput: boolean; inputEnabled: boolean; inputNotTabbable: boolean;
}>;
export type KeyboardChooserSnapshot = Readonly<{
  initial: ChooserState; current: ChooserState; enters: number; inputClicks: number;
  enter: null | Readonly<{ targetRoot: boolean; trusted: boolean; repeat: boolean;
    state: ChooserState; defaultPrevented: boolean }>;
  click: null | Readonly<{ afterEnter: boolean; state: ChooserState; defaultPrevented: boolean }>;
}>;

// Self-contained: Playwright serializes this function, not its module scope.
export function installKeyboardChooserObservation(element: Element) {
  const root = element as HTMLElement;
  const document = root.ownerDocument;
  const input = root.querySelector<HTMLInputElement>('input[type="file"]');
  const state = (): ChooserState => ({
    rootConnected: root.isConnected,
    rootVisible: root.getClientRects().length > 0,
    rootEnabled: root.getAttribute('aria-disabled') === 'false'
      && !root.matches(':disabled') && root.closest('[inert], [aria-disabled="true"]') === null,
    rootIdle: root.getAttribute('aria-busy') === 'false',
    rootTabbable: root.tabIndex === 0,
    rootFocused: document.activeElement === root,
    inputCount: Math.min(2, root.querySelectorAll('input[type="file"]').length),
    sameInput: input !== null && input.isConnected && root.querySelector('input[type="file"]') === input,
    inputEnabled: input !== null && !input.disabled && !input.matches(':disabled'),
    inputNotTabbable: input !== null && input.tabIndex === -1,
  });
  const initial = state();
  let enters = 0, inputClicks = 0;
  let enter: { event: KeyboardEvent; targetRoot: boolean; state: ChooserState } | null = null;
  let click: { event: Event; afterEnter: boolean; state: ChooserState } | null = null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    enters = Math.min(2, enters + 1);
    enter ??= { event, targetRoot: event.target === root, state: state() };
  };
  const onClick = (event: Event) => {
    if (event.target !== input) return;
    inputClicks = Math.min(2, inputClicks + 1);
    click ??= { event, afterEnter: enters === 1, state: state() };
  };
  // Capture sees the input click even when dropzone stops its propagation.
  // Keeping the original Event also exposes cancellation AFTER our listener.
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onClick, true);
  return {
    snapshot(): KeyboardChooserSnapshot {
      return {
        initial, current: state(), enters, inputClicks,
        enter: enter === null ? null : { targetRoot: enter.targetRoot, trusted: enter.event.isTrusted,
          repeat: enter.event.repeat, state: enter.state, defaultPrevented: enter.event.defaultPrevented },
        click: click === null ? null : { afterEnter: click.afterEnter, state: click.state,
          defaultPrevented: click.event.defaultPrevented },
      };
    },
    isOriginalInput(candidate: Node): boolean {
      const current = state();
      return candidate === input && current.rootConnected && current.sameInput && current.inputCount === 1;
    },
    stop() {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
    },
  };
}

export function chooserReady(state: ChooserState): boolean {
  return state.rootConnected && state.rootVisible && state.rootEnabled && state.rootIdle
    && state.rootTabbable && state.inputCount === 1 && state.sameInput
    && state.inputEnabled && state.inputNotTabbable;
}

// A completed DOM chain is NOT a browser PASS: the caller must still await
// the actual native filechooser, verify its input identity and cancel it.
export function keyboardChooserDecision(snapshot: KeyboardChooserSnapshot): string {
  if (!chooserReady(snapshot.initial)) return 'PRECONDITION_NOT_READY';
  if (!snapshot.initial.rootFocused) return 'PRECONDITION_FOCUS_MISSING';
  if (snapshot.enters === 0 || snapshot.enter === null) return 'ENTER_NOT_OBSERVED';
  if (snapshot.enters !== 1) return 'ENTER_DUPLICATED';
  if (!snapshot.enter.trusted || snapshot.enter.repeat) return 'ENTER_UNTRUSTED_OR_REPEATED';
  if (!snapshot.enter.targetRoot) return 'ENTER_WRONG_TARGET';
  if (!chooserReady(snapshot.enter.state) || !snapshot.enter.state.rootFocused) return 'ENTER_STATE_CHANGED';
  if (snapshot.inputClicks === 0 || snapshot.click === null) return snapshot.enter.defaultPrevented
    ? 'ENTER_HANDLED_WITHOUT_INPUT_CLICK' : 'ROOT_ENTER_UNHANDLED';
  if (snapshot.inputClicks !== 1) return 'INPUT_CLICK_DUPLICATED';
  if (!snapshot.click.afterEnter) return 'INPUT_CLICK_BEFORE_ENTER';
  if (!chooserReady(snapshot.click.state)) return 'INPUT_CLICK_STATE_CHANGED';
  if (snapshot.click.defaultPrevented) return 'INPUT_CLICK_CANCELED';
  if (!chooserReady(snapshot.current)) return 'ELEMENTS_CHANGED_AFTER_ENTER';
  return 'AWAIT_NATIVE_CHOOSER';
}
