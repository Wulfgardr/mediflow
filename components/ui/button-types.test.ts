import assert from 'node:assert/strict';
import test from 'node:test';
import type { ButtonProps } from './button';

const namedIcon: ButtonProps = { variant: 'icon', 'aria-label': 'Apri altre azioni', children: '⋯' };
// @ts-expect-error Il ruolo icona richiede un nome accessibile.
const unnamedIcon: ButtonProps = { variant: 'icon', children: '⋯' };
// @ts-expect-error Il tono pieno di conferma appartiene solo al distruttivo.
const invalidConfirmation: ButtonProps = { variant: 'text', confirmation: true, children: 'Esegui' };

test('il contratto dei ruoli conserva nome icona e confine della conferma', () => {
  assert.equal(namedIcon['aria-label'], 'Apri altre azioni');
  assert.equal(unnamedIcon.variant, 'icon');
  assert.equal(invalidConfirmation.variant, 'text');
});
