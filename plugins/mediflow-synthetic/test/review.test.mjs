import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { mountReview } from '../src/app.mjs';
import { viewModel } from '../src/fixture.mjs';

async function setup(supported = true, update = async () => ({ updateId: 'synthetic-context-1' })) {
  const dom = new JSDOM(await readFile(new URL('../src/app.html', import.meta.url), 'utf8'));
  const calls = [];
  const app = { addEventListener() {}, getHostContext: () => ({}), async connect() {
    assert.equal(typeof this.ontoolresult, 'function');
    this.ontoolresult({ structuredContent: viewModel('review') });
  } };
  const extensions = {};
  // Extensions are unavailable until initialization; detection must be dynamic.
  const connect = app.connect;
  app.connect = async function () {
    if (supported) extensions.modelContext = { async update(payload) {
      calls.push(payload); return update(payload);
    } };
    await connect.call(this);
  };
  const controller = await mountReview(dom.window.document, app, extensions);
  return { dom, document: dom.window.document, calls, controller, app };
}
function select(document) {
  const input = document.querySelector('input'); input.checked = true;
  input.dispatchEvent(new document.defaultView.Event('change'));
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('UI selection and cancellation never attach; only explicit confirmation sends fixed excerpt', async () => {
  const { dom, document, calls } = await setup();
  try {
    assert.equal(calls.length, 0);
    select(document); assert.equal(calls.length, 0);
    document.querySelector('#attach').click();
    assert.equal(document.querySelector('#confirmation').hidden, false);
    document.querySelector('#cancel').click(); await settle();
    assert.equal(calls.length, 0);
    document.querySelector('#attach').click(); document.querySelector('#confirm').click(); await settle();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].structuredContent, { synthetic: true, exampleId: 'demo-result' });
    assert.match(calls[0].content[0].text, /^ESEMPIO INVENTATO:/);
    assert.match(document.querySelector('#status').textContent, /aggiunto/);
    document.querySelector('#attach').click(); document.querySelector('#confirm').click(); await settle();
    assert.equal(calls.length, 1);
  } finally { dom.window.close(); }
});

test('unsupported host renders useful review and disables context attachment', async () => {
  const { dom, document, calls } = await setup(false);
  try {
    assert.equal(document.querySelectorAll('input').length, 2);
    select(document);
    assert.equal(document.querySelector('#attach').disabled, true);
    assert.match(document.querySelector('#excerpt').textContent, /ESEMPIO INVENTATO/);
    assert.equal(calls.length, 0);
  } finally { dom.window.close(); }
});

test('concurrent confirmations cannot duplicate or change selected context; unconfirmed/failed updates are honest', async () => {
  let finish;
  const { dom, controller, calls } = await setup(true, () => new Promise((resolve) => { finish = resolve; }));
  try {
    assert.equal(controller.select('arbitrary-patient'), false);
    controller.select('demo-result'); controller.requestAttachment();
    const pending = controller.confirm();
    assert.equal(controller.select('demo-follow-up'), false);
    assert.equal(await controller.confirm(), 'busy');
    finish(undefined);
    assert.equal(await pending, 'unconfirmed');
    assert.equal(calls.length, 1);
  } finally { dom.window.close(); }
  const failed = await setup(true, () => { throw Error('sensitive host detail'); });
  try {
    select(failed.document); failed.document.querySelector('#attach').click();
    failed.document.querySelector('#confirm').click(); await settle();
    assert.match(failed.document.querySelector('#status').textContent, /non confermata/);
    assert.equal(failed.document.body.textContent.includes('sensitive host detail'), false);
  } finally { failed.dom.window.close(); }
});
