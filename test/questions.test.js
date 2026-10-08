const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateQuestions, countQuestions } = require('../src/questions');

const ok = { q: '¿2+2?', o: ['3', '4'], a: 1 };

test('acepta el banco de preguntas incluido en el repositorio', () => {
  const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'questions.json'), 'utf8'));
  assert.doesNotThrow(() => validateQuestions(bank));
  assert.ok(countQuestions(bank) > 0);
});

test('acepta un banco vacío y listas vacías', () => {
  assert.doesNotThrow(() => validateQuestions({}));
  assert.doesNotThrow(() => validateQuestions({ ronda1: [] }));
});

test('rechaza valores que no son un objeto', () => {
  for (const bad of [null, undefined, [], 'texto', 42]) {
    assert.throws(() => validateQuestions(bad), /Debe ser un objeto/);
  }
});

test('rechaza una ronda que no es lista', () => {
  assert.throws(() => validateQuestions({ ronda1: 'x' }), /debe ser una lista/);
});

test('rechaza preguntas sin texto', () => {
  assert.throws(() => validateQuestions({ r: [{ ...ok, q: '' }] }), /falta "q"/);
  assert.throws(() => validateQuestions({ r: [{ ...ok, q: '   ' }] }), /falta "q"/);
  assert.throws(() => validateQuestions({ r: [null] }), /falta "q"/);
});

test('exige entre 2 y 4 opciones', () => {
  assert.throws(() => validateQuestions({ r: [{ ...ok, o: ['solo una'], a: 0 }] }), /de 2 a 4 opciones/);
  assert.throws(() => validateQuestions({ r: [{ ...ok, o: ['1', '2', '3', '4', '5'] }] }), /de 2 a 4 opciones/);
  assert.throws(() => validateQuestions({ r: [{ ...ok, o: 'no es lista' }] }), /de 2 a 4 opciones/);
});

test('la respuesta correcta debe ser un índice válido', () => {
  for (const a of [-1, 2, 1.5, '1', null]) {
    assert.throws(() => validateQuestions({ r: [{ ...ok, a }] }), /"a" debe ser el índice/);
  }
});

test('el mensaje de error indica la ronda y la posición', () => {
  assert.throws(() => validateQuestions({ ronda3: [ok, { ...ok, a: 9 }] }), /ronda3 #2/);
});

test('countQuestions suma todas las rondas e ignora lo que no es lista', () => {
  assert.equal(countQuestions({ a: [ok, ok], b: [ok], c: 'x' }), 3);
  assert.equal(countQuestions({}), 0);
});
