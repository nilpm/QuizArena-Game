/**
 * Validación del banco de preguntas.
 *
 * Formato esperado (ver data/questions.json):
 *   { "ronda1": [ { "q": "Pregunta", "o": ["A", "B", "C", "D"], "a": 1 } ], ... }
 *   - q: texto de la pregunta
 *   - o: de 2 a 4 opciones
 *   - a: índice (base 0) de la opción correcta
 */

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/**
 * Lanza un Error con un mensaje legible si el banco de preguntas no es válido.
 * @param {unknown} bank
 */
function validateQuestions(bank) {
  if (!bank || typeof bank !== 'object' || Array.isArray(bank)) {
    throw new Error('Debe ser un objeto: { "ronda1": [...], ... }');
  }
  for (const [key, list] of Object.entries(bank)) {
    if (!Array.isArray(list)) throw new Error(`"${key}" debe ser una lista`);
    list.forEach((item, i) => {
      const where = `${key} #${i + 1}`;
      if (!item || typeof item.q !== 'string' || !item.q.trim()) {
        throw new Error(`${where}: falta "q" (texto)`);
      }
      if (!Array.isArray(item.o) || item.o.length < MIN_OPTIONS || item.o.length > MAX_OPTIONS) {
        throw new Error(`${where}: "o" debe tener de ${MIN_OPTIONS} a ${MAX_OPTIONS} opciones`);
      }
      if (!Number.isInteger(item.a) || item.a < 0 || item.a >= item.o.length) {
        throw new Error(`${where}: "a" debe ser el índice (0-${item.o.length - 1}) de la correcta`);
      }
    });
  }
}

/** Total de preguntas en el banco (ignora entradas que no sean listas). */
function countQuestions(bank) {
  return Object.values(bank).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

module.exports = { validateQuestions, countQuestions };
