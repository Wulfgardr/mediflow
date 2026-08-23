/* @Codex */

import assert from 'node:assert/strict';
import test from 'node:test';

import { nextVirtualRowIndex } from './kree8-keyboard-navigation';

test('le frecce e j/k attraversano l’intero indice con limiti stabili', () => {
  assert.equal(nextVirtualRowIndex({ key: 'ArrowDown', currentIndex: 7, rowCount: 20, pageSize: 5 }), 8);
  assert.equal(nextVirtualRowIndex({ key: 'j', currentIndex: 19, rowCount: 20, pageSize: 5 }), 19);
  assert.equal(nextVirtualRowIndex({ key: 'ArrowUp', currentIndex: 0, rowCount: 20, pageSize: 5 }), 0);
  assert.equal(nextVirtualRowIndex({ key: 'k', currentIndex: 8, rowCount: 20, pageSize: 5 }), 7);
});

test('Home, End e Page Up/Down lavorano sull’indice non renderizzato', () => {
  assert.equal(nextVirtualRowIndex({ key: 'Home', currentIndex: 48, rowCount: 100, pageSize: 8 }), 0);
  assert.equal(nextVirtualRowIndex({ key: 'End', currentIndex: 2, rowCount: 100, pageSize: 8 }), 99);
  assert.equal(nextVirtualRowIndex({ key: 'PageDown', currentIndex: 48, rowCount: 100, pageSize: 8 }), 56);
  assert.equal(nextVirtualRowIndex({ key: 'PageUp', currentIndex: 3, rowCount: 100, pageSize: 8 }), 0);
});

test('una lista vuota non produce un indice attivo', () => {
  assert.equal(nextVirtualRowIndex({ key: 'End', currentIndex: 0, rowCount: 0, pageSize: 8 }), null);
});
