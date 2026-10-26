// Unidades del negocio. ÚNICO lugar de la conversión kg ↔ libras en el backend
// (la app tiene la misma constante en util/Formato.kt).
//
// Libra colombiana: 500 g → 1 kg = 2 libras (no la libra inglesa de 453,6 g).
const LIBRAS_POR_KG = 2;
// Una lata de leche son 20 litros
const LITROS_POR_LATA = 20;

/** kg de una cantidad vendida en 'kg' o 'libras'. */
const aKg = (cantidad, unidad) => (unidad === 'libras' ? cantidad / LIBRAS_POR_KG : Number(cantidad));

/** Precio por libra a partir del precio por kg (redondeado a pesos). */
const precioPorLibra = (precioPorKg) => Math.round(precioPorKg / LIBRAS_POR_KG);

/** Rendimiento = libras de queso por lata de leche = (kg × 2) ÷ (litros ÷ 20). */
const librasPorLata = (kg, litros) => (litros > 0 ? Math.round((kg * LIBRAS_POR_KG / (litros / LITROS_POR_LATA)) * 100) / 100 : 0);

module.exports = { LIBRAS_POR_KG, LITROS_POR_LATA, aKg, precioPorLibra, librasPorLata };
