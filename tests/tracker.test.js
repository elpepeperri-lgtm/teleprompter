const assert = require('node:assert/strict');
const T = require('../tracker.js');

const SCRIPT = `Hola, bienvenidos a mi canal. Hoy quiero hablarles de tres hábitos que cambiaron mi vida.
El primero es levantarme temprano: la mañana es el mejor momento para concentrarme.
El segundo es leer todos los días, aunque sean solo diez minutos.
Y el tercero, quizás el más importante, es agradecer antes de dormir.
Si te gustó este video, suscríbete y cuéntame en los comentarios cuál es tu hábito favorito.`;

const norms = T.scriptWords(SCRIPT);
const idx = (w) => norms.indexOf(T.normalize(w));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Simula al reconocedor: va entregando la frase palabra por palabra (resultados intermedios) y al final cierra.
function speak(tr, phrase, { final = true } = {}) {
  const w = T.speechWords(phrase);
  for (let i = 1; i <= w.length; i++) tr.update(w.slice(0, i), false);
  if (final) tr.update(w, true);
  return tr.pos;
}

test('normalize ignora tildes, mayúsculas y puntuación', () => {
  assert.equal(T.normalize('¡Mañana!'), 'manana');
  assert.equal(T.normalize('HÁBITOS,'), 'habitos');
  assert.deepEqual(T.scriptWords('Hola—mundo, ¿qué tal?'), ['hola', 'mundo', 'que', 'tal']);
});

test('lectura perfecta avanza hasta la palabra siguiente', () => {
  const tr = T.create(norms);
  speak(tr, 'hola bienvenidos a mi canal');
  assert.equal(tr.pos, idx('canal') + 1);
});

test('sin tildes y en minúsculas', () => {
  const tr = T.create(norms);
  speak(tr, 'hola bienvenidos a mi canal hoy quiero hablarles de tres habitos que cambiaron mi vida');
  assert.equal(tr.pos, idx('vida') + 1);
});

test('errores de reconocimiento (distancia de Levenshtein)', () => {
  const tr = T.create(norms);
  speak(tr, 'ola bienvenido a mi canal hoy quiero hablarle de tres abitos que cambiaron mi vida');
  assert.equal(tr.pos, idx('vida') + 1);
});

test('palabras saltadas', () => {
  const tr = T.create(norms);
  speak(tr, 'hola bienvenidos canal hoy hablarles tres habitos cambiaron vida');
  assert.equal(tr.pos, idx('vida') + 1);
});

test('salto de una frase entera hacia delante dentro de la ventana', () => {
  const tr = T.create(norms);
  speak(tr, 'hola bienvenidos a mi canal');
  speak(tr, 'tres habitos que cambiaron mi vida');
  assert.equal(tr.pos, idx('vida') + 1);
});

test('nunca retrocede si repito una frase anterior', () => {
  const tr = T.create(norms);
  speak(tr, 'hola bienvenidos a mi canal hoy quiero hablarles de tres habitos');
  const before = tr.pos;
  speak(tr, 'hola bienvenidos a mi canal');
  assert.ok(tr.pos >= before);
});

test('ruido o palabras que no están en el guion no mueven la posición', () => {
  const tr = T.create(norms);
  speak(tr, 'hola bienvenidos');
  const before = tr.pos;
  speak(tr, 'perro gato televisor camioneta');
  assert.equal(tr.pos, before);
});

test('no salta a una palabra que está más allá de la ventana de 15 palabras', () => {
  const tr = T.create(norms);
  speak(tr, 'comentarios');  // aparece al final del guion, muy lejos
  assert.equal(tr.pos, 0);
});

test('palabras cortas comunes no provocan saltos lejanos', () => {
  const tr = T.create(norms);
  speak(tr, 'el el el de de');
  assert.ok(tr.pos <= 6, 'pos=' + tr.pos);
});

test('reinicio de la sesión (Safari corta el reconocimiento) conserva la posición', () => {
  const tr = T.create(norms);
  speak(tr, 'hola bienvenidos a mi canal hoy quiero');
  const before = tr.pos;
  tr.resetSession();                                   // onend -> reinicio automático
  speak(tr, 'hablarles de tres habitos');
  assert.ok(tr.pos > before);
  assert.equal(tr.pos, idx('habitos') + 1);
});

test('palabra a medias en resultado intermedio se confirma al finalizar', () => {
  const tr = T.create(norms);
  tr.update(['hola', 'bienvenid'], false);
  assert.ok(tr.pos >= 1);
  tr.update(['hola', 'bienvenidos'], true);
  assert.equal(tr.pos, 2);
});

test('toque manual mueve la posición (también hacia atrás) y sigue desde ahí', () => {
  const tr = T.create(norms);
  speak(tr, 'hola bienvenidos a mi canal hoy quiero hablarles');
  tr.setPos(idx('segundo'));
  assert.equal(tr.pos, idx('segundo'));
  tr.resetSession();
  speak(tr, 'segundo es leer todos los dias');
  assert.equal(tr.pos, idx('dias') + 1);
});

test('lectura completa de principio a fin', () => {
  const tr = T.create(norms);
  for (const line of SCRIPT.split('\n')) speak(tr, line);
  assert.equal(tr.pos, norms.length);
  assert.ok(tr.done);
});

test('lectura completa con errores, sin tildes y saltos', () => {
  const tr = T.create(norms);
  const noisy = `ola bienvenidos a mi canal oy quiero hablarles tres abitos que cambiaron mi vida
primero es levantarme temprano mañana es el mejor momento concentrarme
el segundo es leer todos los dias aunque sean diez minutos
el tercero quizas el mas importante es agradecer antes de dormir
si te gusto este video suscribete y cuentame en los comentarios cual es tu habito favorito`;
  for (const line of noisy.split('\n')) speak(tr, line);
  assert.ok(tr.pos >= norms.length - 1, `pos=${tr.pos} de ${norms.length}`);
});

console.log(`\n${passed} pruebas pasaron`);

test('errores fon�ticos (v/b, h muda, s/z)', () => {
  const tr = T.create(norms);
  speak(tr, 'ola bienbenidos a mi canal oy quiero ablarles de tres abitos');
  assert.equal(tr.pos, idx('habitos') + 1);
});
console.log('fin');
