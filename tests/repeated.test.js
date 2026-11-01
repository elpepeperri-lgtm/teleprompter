const assert = require('node:assert/strict');
const T = require('../tracker.js');

const norms = T.scriptWords('Voy a la casa de la abuela porque la casa de la abuela es grande y la casa es bonita y la abuela es feliz');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }
const w = (s) => T.speechWords(s);

test('palabra repetida: el final del parcial no se cuenta dos veces', () => {
  const tr = T.create(norms);
  tr.update(w('voy a la casa'), false);
  tr.update(w('voy a la casa de la'), false);
  assert.equal(tr.pos, 6);
  tr.update(w('voy a la casa de la'), true);        // el final llega igual que el parcial
  assert.equal(tr.pos, 6);
  tr.update(w('voy a la casa de la abuela'), false);
  assert.equal(tr.pos, 7);
});

test('el final trae menos palabras que el parcial y no adelanta el guion', () => {
  const tr = T.create(norms);
  tr.update(w('voy a la casa de la abuela'), false);
  assert.equal(tr.pos, 7);
  tr.update(w('voy a la casa de abuela'), true);    // el reconocedor perdió una palabra al finalizar
  assert.equal(tr.pos, 7);
  tr.update(w('voy a la casa de abuela porque la'), false);
  assert.equal(tr.pos, 9);
});

test('una palabra corta suelta no salta a su repetición más adelante', () => {
  const tr = T.create(norms);
  tr.update(w('voy a'), true);
  tr.update(w('voy a de'), false);                  // "de" suelta (ruido) no debe saltar a "de la casa"
  assert.equal(tr.pos, 2);
});

test('lectura con palabras repetidas termina exactamente al final', () => {
  const tr = T.create(norms);
  const words = w('voy a la casa de la abuela porque la casa de la abuela es grande y la casa es bonita y la abuela es feliz');
  for (let i = 1; i <= words.length; i++) tr.update(words.slice(0, i), i % 5 === 0);
  tr.update(words, true);
  assert.equal(tr.pos, norms.length);
});

console.log(`\n${passed} pruebas pasaron`);
