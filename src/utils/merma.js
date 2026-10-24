// Merma automática del queso por semana (viernes a jueves).
//
//   merma = stock inicial + kg producidos − kg vendidos − kg que pasan a la semana siguiente
//
// El stock inicial de una semana es lo que pasó de la anterior (kgFinal, 0 por defecto).
// Las semanas se recalculan en cadena cada vez que se consultan (por si se registró una venta
// o producción tarde); lo único que se conserva tal cual es el kgFinal confirmado por el usuario.

const { Types } = require('mongoose');
const { Produccion, Venta, Precio, CierreSemana } = require('../models');
const { DIA_MS, rangoSemana, semanaDeFecha, textoRango } = require('./semana');

const LIBRAS_POR_KG = 2.2046;
const MAX_SEMANAS = 52;
const redondear = (n, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };
const clave = (s) => `${s.anio}-${s.semana}`;

/** kg vendidos de una venta (las ventas por libras se pasan a kg). */
const kgDeVenta = (v) => (v.unidad === 'libras' ? v.cantidad / LIBRAS_POR_KG : v.cantidad);

/** Lista de semanas desde [desde] hasta [hasta] (inclusive), en orden. */
function semanasEntre(desde, hasta) {
  const lista = [];
  let inicio = rangoSemana(desde.semana, desde.anio).inicio;
  const fin = rangoSemana(hasta.semana, hasta.anio).inicio;
  while (inicio <= fin) {
    lista.push(semanaDeFecha(inicio));
    inicio = new Date(inicio.getTime() + 7 * DIA_MS);
  }
  return lista;
}

/**
 * Recalcula y guarda los cierres de las semanas ya cerradas y devuelve:
 * - semanas: cierres (más reciente primero)
 * - promedioPct: % de merma histórico (merma total / producido total)
 * - actual: la semana en curso con su stock estimado (usando el promedio)
 * - pendiente: la última semana cerrada si hay que preguntar cuánto queso sobró
 */
async function calcularMerma(usuarioId, hoy = new Date()) {
  const actual = semanaDeFecha(hoy);
  const idUsuario = new Types.ObjectId(usuarioId);

  const primera = await Produccion.findOne({ usuarioId }).sort({ fecha: 1 }).select('fecha').lean();
  const vacio = {
    semanas: [], promedioPct: 0, pendiente: null,
    actual: { ...actual, ...rangoSemana(actual.semana, actual.anio), stockInicialKg: 0, kgProducidos: 0, kgVendidos: 0, mermaEstimadaKg: 0, stockEstimadoKg: 0 }
  };
  if (!primera) return vacio;

  // Desde la primera producción (máximo un año atrás) hasta la semana en curso
  let desde = semanaDeFecha(new Date(primera.fecha));
  const limite = semanaDeFecha(new Date(rangoSemana(actual.semana, actual.anio).inicio.getTime() - (MAX_SEMANAS - 1) * 7 * DIA_MS));
  if (rangoSemana(desde.semana, desde.anio).inicio < rangoSemana(limite.semana, limite.anio).inicio) desde = limite;
  const semanas = semanasEntre(desde, actual);
  const inicioTotal = rangoSemana(desde.semana, desde.anio).inicio;

  const [producciones, ventas, precios, cierres] = await Promise.all([
    Produccion.aggregate([
      { $match: { usuarioId: idUsuario, fecha: { $gte: inicioTotal } } },
      { $project: { fecha: 1, kgProducidos: 1 } }
    ]),
    Venta.aggregate([
      { $match: { usuarioId: idUsuario, fecha: { $gte: inicioTotal } } },
      { $project: { fecha: 1, cantidad: 1, unidad: 1 } }
    ]),
    Precio.find({ usuarioId, fechaFin: { $gte: inicioTotal } }).sort({ createdAt: -1 }).lean(),
    CierreSemana.find({ usuarioId, fechaInicio: { $gte: inicioTotal } })
  ]);

  const producidoDe = {}, vendidoDe = {};
  for (const p of producciones) { const k = clave(semanaDeFecha(p.fecha)); producidoDe[k] = (producidoDe[k] || 0) + (p.kgProducidos || 0); }
  for (const v of ventas) { const k = clave(semanaDeFecha(v.fecha)); vendidoDe[k] = (vendidoDe[k] || 0) + kgDeVenta(v); }
  const cierreDe = Object.fromEntries(cierres.map(c => [clave(c), c]));
  const precioDe = (s, inicio, fin) =>
    (precios.find(p => p.semana === s.semana && p.anio === s.anio && +p.fechaInicio === +inicio)
      || precios.find(p => p.fechaInicio <= fin && p.fechaFin >= inicio))?.precioPorKg || 0;

  const cerradas = [];
  let anteriorFinal = 0;
  for (const s of semanas) {
    const { inicio, fin } = rangoSemana(s.semana, s.anio);
    const k = clave(s);
    const inicial = anteriorFinal;
    const producido = redondear(producidoDe[k] || 0);
    const vendido = redondear(vendidoDe[k] || 0);

    if (k === clave(actual)) {
      // Semana en curso: stock estimado con la merma promedio (se calcula más abajo)
      anteriorFinal = inicial;
      break;
    }

    let c = cierreDe[k];
    if (!c && !producido && !vendido && !inicial) { anteriorFinal = 0; continue; }
    if (!c) c = new CierreSemana({ usuarioId, semana: s.semana, anio: s.anio });

    const kgFinal = c.kgFinal || 0;
    const merma = redondear(inicial + producido - vendido - kgFinal);
    const precioKg = precioDe(s, inicio, fin);
    c.set({
      fechaInicio: inicio, fechaFin: fin,
      stockInicialKg: redondear(inicial), kgProducidos: producido, kgVendidos: vendido,
      mermaKg: merma,
      mermaPct: producido > 0 ? redondear((merma / producido) * 100, 1) : 0,
      precioPorKg: precioKg,
      valorMerma: merma > 0 ? Math.round(merma * precioKg) : 0
    });
    if (c.isNew || c.isModified()) await c.save();
    cerradas.push(c);
    anteriorFinal = kgFinal;
  }

  const rActual = rangoSemana(actual.semana, actual.anio);

  // ¿Hay que preguntar por la última semana cerrada? Solo si, con la merma promedio de las otras
  // semanas, parece que sobró queso (más de 1 kg o del 3 % de lo producido).
  let pendiente = null;
  const ultima = cerradas[cerradas.length - 1];
  const semanaPrevia = semanaDeFecha(new Date(rActual.inicio.getTime() - DIA_MS));
  if (ultima && !ultima.confirmado && clave(ultima) === clave(semanaPrevia)) {
    const sobrante = redondear(ultima.stockInicialKg + ultima.kgProducidos - ultima.kgVendidos
      - ultima.kgProducidos * promedioPctSin(cerradas, ultima) / 100);
    if (sobrante > Math.max(1, ultima.kgProducidos * 0.03)) {
      pendiente = {
        semana: ultima.semana, anio: ultima.anio,
        texto: textoRango(ultima.fechaInicio, ultima.fechaFin),
        sobranteEstimadoKg: sobrante
      };
    }
  }

  // Promedio histórico ponderado (merma total / producido total). La semana pendiente no cuenta:
  // su merma es provisional hasta que se confirme cuánto queso pasó a la siguiente.
  const promedioPct = redondear(promedioPctSin(cerradas, pendiente ? ultima : null), 1);

  // Semana en curso: stock estimado con la merma promedio
  const kActual = clave(actual);
  const producidoActual = redondear(producidoDe[kActual] || 0);
  const vendidoActual = redondear(vendidoDe[kActual] || 0);
  const mermaEstimada = redondear(producidoActual * promedioPct / 100);
  const semanaActual = {
    ...actual,
    fechaInicio: rActual.inicio, fechaFin: rActual.fin, texto: textoRango(rActual.inicio, rActual.fin),
    stockInicialKg: redondear(anteriorFinal),
    kgProducidos: producidoActual,
    kgVendidos: vendidoActual,
    mermaEstimadaKg: mermaEstimada,
    stockEstimadoKg: Math.max(0, redondear(anteriorFinal + producidoActual - vendidoActual - mermaEstimada))
  };

  return {
    semanas: cerradas.slice().reverse().map(c => ({ ...c.toObject(), texto: textoRango(c.fechaInicio, c.fechaFin) })),
    promedioPct,
    actual: semanaActual,
    pendiente
  };
}

/** % de merma promedio ponderado de las semanas válidas, sin contar [excluir] (puede ser null). */
function promedioPctSin(cerradas, excluir) {
  const otras = cerradas.filter(c => c !== excluir && c.kgProducidos > 0 && c.mermaKg >= 0);
  const producido = otras.reduce((s, c) => s + c.kgProducidos, 0);
  return producido > 0 ? (otras.reduce((s, c) => s + c.mermaKg, 0) / producido) * 100 : 0;
}

module.exports = { calcularMerma, kgDeVenta };
