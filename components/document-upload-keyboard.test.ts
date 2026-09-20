/* @Codex: deterministic DOM/event adapter tests, NOT React/Chromium/chooser proof. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  chooserReady, installKeyboardChooserObservation, keyboardChooserDecision,
  type KeyboardChooserSnapshot,
} from '../e2e/anydoc-keyboard-chooser.ts';

type Listener = (event: Record<string, unknown>) => void;
function fixture(install = installKeyboardChooserObservation) {
  const listeners = new Map<string, Set<Listener>>();
  const document = {
    activeElement: null as unknown,
    addEventListener(name: string, listener: Listener, capture: boolean) {
      assert.equal(capture, true);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener(name: string, listener: Listener, capture: boolean) {
      assert.equal(capture, true); listeners.get(name)?.delete(listener);
    },
  };
  const input = { isConnected: true, disabled: false, inheritedDisabled: false, tabIndex: -1,
    matches: () => input.disabled || input.inheritedDisabled };
  let inputs = [input];
  const root = {
    ownerDocument: document, isConnected: true, visible: true, blocked: false,
    disabled: false, ariaDisabled: 'false', ariaBusy: 'false', tabIndex: 0,
    getClientRects: () => root.visible ? [{}] : [],
    matches: () => root.disabled,
    closest: () => root.blocked ? {} : null,
    getAttribute(name: string) { return name === 'aria-disabled' ? root.ariaDisabled : name === 'aria-busy' ? root.ariaBusy : null; },
    querySelector: () => inputs[0] ?? null,
    querySelectorAll: () => inputs,
  };
  document.activeElement = root;
  const observation = install(root as unknown as Element);
  function dispatch(name: string, override: Record<string, unknown> = {}) {
    const event = { key: name === 'keydown' ? 'Enter' : undefined, target: name === 'keydown' ? root : input,
      isTrusted: name === 'keydown', repeat: false, defaultPrevented: false, ...override };
    for (const listener of listeners.get(name) ?? []) listener(event);
    return event;
  }
  function valid() {
    const enter = dispatch('keydown');
    // Models the dependency's preventDefault and input.click, not a real DOM gesture.
    enter.defaultPrevented = true;
    dispatch('click');
    return observation.snapshot();
  }
  return { root, input, document, listeners, observation, dispatch, valid,
    replaceInput: () => { inputs = [{ ...input }]; }, duplicateInput: () => { inputs = [input, { ...input }]; } };
}

const decision = (f: ReturnType<typeof fixture>) => keyboardChooserDecision(f.observation.snapshot());

test('valid metadata only authorizes waiting for a native chooser, never declares browser success', () => {
  const f = fixture(); const snapshot = f.valid();
  assert.equal(chooserReady(snapshot.initial), true);
  assert.equal(keyboardChooserDecision(snapshot), 'AWAIT_NATIVE_CHOOSER');
  assert.equal(f.observation.isOriginalInput(f.input as unknown as Element), true);
  assert.equal(f.observation.isOriginalInput({ ...f.input } as unknown as Element), false);
});

test('observer serializes without module closure or Playwright/runtime globals', () => {
  const serialized = runInNewContext(`(${installKeyboardChooserObservation.toString()})`) as typeof installKeyboardChooserObservation;
  const f = fixture(serialized);
  assert.equal(keyboardChooserDecision(f.valid()), 'AWAIT_NATIVE_CHOOSER');
});

test('listener is passive and reads cancellation performed later in the same dispatch', () => {
  const f = fixture(); const event = f.dispatch('keydown');
  assert.equal(event.defaultPrevented, false);
  assert.equal(f.observation.snapshot().inputClicks, 0, 'observer must not activate input');
  event.defaultPrevented = true;
  const click = f.dispatch('click');
  assert.equal(decision(f), 'AWAIT_NATIVE_CHOOSER');
  click.defaultPrevented = true;
  assert.equal(decision(f), 'INPUT_CLICK_CANCELED');
});

test('wrong target remains wrong even if focus later returns to the root', () => {
  const f = fixture(); f.document.activeElement = f.input;
  f.dispatch('keydown', { target: f.input });
  f.document.activeElement = f.root;
  assert.equal(decision(f), 'ENTER_WRONG_TARGET');
});

test('a focus loss with a root-targeted event is not repaired or accepted', () => {
  const f = fixture(); f.document.activeElement = null;
  f.dispatch('keydown'); f.document.activeElement = f.root;
  assert.equal(decision(f), 'ENTER_STATE_CHANGED');
});

for (const [name, change] of [
  ['aria disabled', (f: ReturnType<typeof fixture>) => { f.root.ariaDisabled = 'true'; }],
  ['processing', (f: ReturnType<typeof fixture>) => { f.root.ariaBusy = 'true'; }],
  ['inert/disabled ancestor', (f: ReturnType<typeof fixture>) => { f.root.blocked = true; }],
  ['native input disabled', (f: ReturnType<typeof fixture>) => { f.input.disabled = true; }],
  ['fieldset disabled', (f: ReturnType<typeof fixture>) => { f.input.inheritedDisabled = true; }],
  ['hidden root', (f: ReturnType<typeof fixture>) => { f.root.visible = false; }],
  ['detached root', (f: ReturnType<typeof fixture>) => { f.root.isConnected = false; }],
  ['input replaced', (f: ReturnType<typeof fixture>) => { f.replaceInput(); }],
  ['input duplicated', (f: ReturnType<typeof fixture>) => { f.duplicateInput(); }],
  ['root not tabbable', (f: ReturnType<typeof fixture>) => { f.root.tabIndex = -1; }],
  ['extra input tab stop', (f: ReturnType<typeof fixture>) => { f.input.tabIndex = 0; }],
] as const) test(`state at Enter rejects ${name}, even if readiness was true before`, () => {
  const f = fixture(); change(f); f.dispatch('keydown');
  assert.equal(decision(f), 'ENTER_STATE_CHANGED');
});

test('missing and prevented-but-unforwarded Enter have distinct decisions', () => {
  const f = fixture(); assert.equal(decision(f), 'ENTER_NOT_OBSERVED');
  const enter = f.dispatch('keydown'); assert.equal(decision(f), 'ROOT_ENTER_UNHANDLED');
  enter.defaultPrevented = true; assert.equal(decision(f), 'ENTER_HANDLED_WITHOUT_INPUT_CLICK');
});

test('synthetic/repeated/duplicate Enter cannot pass; counts stay bounded', () => {
  const synthetic = fixture(); synthetic.dispatch('keydown', { isTrusted: false });
  assert.equal(decision(synthetic), 'ENTER_UNTRUSTED_OR_REPEATED');
  const repeated = fixture(); repeated.dispatch('keydown', { repeat: true });
  assert.equal(decision(repeated), 'ENTER_UNTRUSTED_OR_REPEATED');
  const multiple = fixture(); for (let i = 0; i < 10; i++) multiple.dispatch('keydown');
  assert.equal(multiple.observation.snapshot().enters, 2);
  assert.equal(decision(multiple), 'ENTER_DUPLICATED');
});

test('input click must be singular and follow Enter', () => {
  const f = fixture(); f.dispatch('click'); f.dispatch('keydown');
  assert.equal(decision(f), 'INPUT_CLICK_BEFORE_ENTER');
  const duplicate = fixture(); duplicate.valid(); duplicate.dispatch('click');
  assert.equal(decision(duplicate), 'INPUT_CLICK_DUPLICATED');
});

test('input disabled during click or replaced after click fails closed', () => {
  const disabled = fixture(); disabled.dispatch('keydown'); disabled.input.disabled = true; disabled.dispatch('click');
  assert.equal(decision(disabled), 'INPUT_CLICK_STATE_CHANGED');
  const replaced = fixture(); replaced.valid(); replaced.replaceInput();
  assert.equal(decision(replaced), 'ELEMENTS_CHANGED_AFTER_ENTER');
  assert.equal(replaced.observation.isOriginalInput(replaced.input as unknown as Element), false);
});

test('incomplete initial preconditions are never inferred from the later state', () => {
  const f = fixture(); const valid = f.valid();
  const missingFocus: KeyboardChooserSnapshot = { ...valid, initial: { ...valid.initial, rootFocused: false } };
  const disabled: KeyboardChooserSnapshot = { ...valid, initial: { ...valid.initial, inputEnabled: false } };
  assert.equal(keyboardChooserDecision(missingFocus), 'PRECONDITION_FOCUS_MISSING');
  assert.equal(keyboardChooserDecision(disabled), 'PRECONDITION_NOT_READY');
});

test('stop removes both capture listeners; no listener changes focus or runs another action', () => {
  const f = fixture(); f.observation.stop(); f.observation.stop();
  f.dispatch('keydown'); f.dispatch('click');
  assert.equal(f.observation.snapshot().enters, 0); assert.equal(f.observation.snapshot().inputClicks, 0);
  assert.equal(f.document.activeElement, f.root);
  assert.ok([...f.listeners.values()].every(set => set.size === 0));
});

test('browser source keeps real Enter, chooser identity, zero retries and subsequent focus/UI contracts', () => {
  const source = readFileSync('e2e/document-upload-anydoc-focus.spec.ts', 'utf8');
  const start = source.indexOf('const chooser =');
  const end = source.indexOf("await page.keyboard.press('Tab');", start);
  const activation = source.slice(start, end);
  assert.match(source, /test\.describe\.configure\(\{ retries: 0 \}\)/u);
  assert.equal((activation.match(/page\.keyboard\.press\('Enter'\)/gu) ?? []).length, 1);
  assert.ok(activation.indexOf("page.waitForEvent('filechooser')") < activation.indexOf("page.keyboard.press('Enter')"));
  assert.match(activation, /probe\.isOriginalInput\(input\), nativeChooser\.element\(\)/u);
  assert.match(activation, /await nativeChooser\.setFiles\(\[\]\)/u);
  assert.doesNotMatch(activation, /\.click\(|setInputFiles|waitForTimeout|setTimeout|chooser\.press\(/u);
  const afterFocus = activation.slice(activation.indexOf('await chooser.focus();') + 'await chooser.focus();'.length, activation.indexOf("page.keyboard.press('Enter')"));
  assert.doesNotMatch(afterFocus, /\.focus\(/u);
  for (const assertion of ['Visualizza ${SYNTHETIC_ATTACHMENT_NAME}', 'Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}',
    'Prepara sintesi di ${SYNTHETIC_ATTACHMENT_NAME}', 'Elimina ${SYNTHETIC_ATTACHMENT_NAME}',
    "toHaveCSS('opacity', '1')", 'width: 390, height: 844', 'expect(consoleErrors).toEqual([])']) assert.ok(source.includes(assertion), assertion);
});
