// Validación de cantidades y precios que deben ser números mayores que 0 (litros, kilos, cantidad
// vendida, precios). Responde 400 con un mensaje claro en lugar de guardar un valor sin sentido.
const { errorHttp } = require('./inventario');

// [nombre en la frase, es plural]
const CAMPOS = {
  litros: ['los litros', true],
  litrosUsados: ['los litros usados', true],
  kgProducidos: ['los kilos producidos', true],
  cantidad: ['la cantidad vendida', false],
  precioUnitario: ['el precio de la venta', false],
  precioPorKg: ['el precio minorista', false],
  precioMayoristaPorKg: ['el precio mayorista', false],
  precioLitro: ['el precio del litro', false]
};

const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** true si el valor no se envió (undefined, null o texto vacío). */
const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Devuelve [valor] como número finito mayor que 0, o lanza un error 400:
 *   "Faltan los litros" / "Los litros deben ser un número" / "Los litros deben ser mayores que 0".
 * Solo acepta números o texto numérico (no booleanos ni objetos: Number(true) sería 1).
 */
function positivo(valor, campo) {
  const [nombre, plural] = CAMPOS[campo] || [campo, false];
  if (vacio(valor)) throw errorHttp(400, `${plural ? 'Faltan' : 'Falta'} ${nombre}`);
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor.trim()) : NaN;
  if (!Number.isFinite(n)) throw errorHttp(400, `${mayuscula(nombre)} ${plural ? 'deben' : 'debe'} ser un número`);
  if (n <= 0) throw errorHttp(400, `${mayuscula(nombre)} ${plural ? 'deben ser mayores' : 'debe ser mayor'} que 0`);
  return n;
}

/** Igual que [positivo], pero si el valor no se envió devuelve null (campos opcionales). */
function positivoOpcional(valor, campo) {
  return vacio(valor) ? null : positivo(valor, campo);
}

module.exports = { positivo, positivoOpcional, vacio };
