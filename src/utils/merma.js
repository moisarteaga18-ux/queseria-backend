// Cuenta de cada semana del queso (viernes a jueves): ventas por lote, ganancia y merma.
//
// Cómo trabaja la quesería: el jueves se cierra la semana de la leche. El queso que queda el jueves
// se termina de vender el viernes siguiente; ese viernes se vende primero el queso que quedó.
//
// 1) VENTAS POR LOTE (lo más viejo primero). El "lote" de una semana es el queso que pasó de la semana
//    anterior + el producido en la semana. Una venta del VIERNES se descuenta primero del lote de la
//    semana que cerró el jueves (hasta lo que le quede, sin tocar lo que el usuario pasó a la semana
//    siguiente); el resto, del lote de la semana nueva. Las ventas de sábado a jueves son del lote de
//    su semana. Así, lo que se vende el viernes cuenta como venta (y ganancia) de la semana que cerró.
//    Las listas de ventas y el resumen del día siguen por fecha: esto solo cambia la cuenta semanal.
//
// 2) GANANCIA de la semana = ventas del queso de esa semana − leche de esa semana (litros × precio del
//    litro). La liquidación de los ganaderos no cambia.
//
// 3) MERMA MANUAL (25 nov 2026): la registra el usuario; ya no se calcula sola.
//      sobrante (kg) = pasado de la semana anterior + producido − vendido del lote (desde el viernes
//                      siguiente, cuando la semana ya cerró).
//      sugerida      = sobrante − lo que se pasó a la semana siguiente (la app la propone; se puede cambiar).
//      merma         = la que registró el usuario (CierreSemana.mermaRegistradaKg); sin registrar = null
//                      y la semana queda "Merma pendiente por registrar".
//      merma + pasado ≤ sobrante (lo valida la ruta al guardar; si después llegan ventas tardías y ya no
//      cabe, la semana queda para "revisar").
//      %             = merma ÷ (pasado de la semana anterior + producido)
//      valor         = merma × precio promedio real de venta del lote (ventas ÷ kg vendidos);
//                      sin ventas, el precio por kilo (minorista) registrado para esa semana.
//    Más del 15 % → "revisar". La merma es informativa: no se resta otra vez de la ganancia.
//    El campo viejo CierreSemana.mermaKg (cálculo automático de antes) se ignora y no se toca.
//
// "Pasar queso a la semana siguiente" es una acción aparte del usuario (CierreSemana.kgFinal).
// Consultar NO escribe nada en la base.

const { Types } = require('mongoose');
const { Produccion, Venta, Precio, PrecioLeche, Leche, CierreSemana } = require('../models');
const { DIA_MS, rangoSemana, semanaDeFecha, textoRango, iso } = require('./semana');
const { aKg } = require('./unidades');

const MAX_SEMANAS = 52;
/** Merma por encima de este % se marca para revisar. */
const MERMA_REVISAR_PCT = 15;
const r2 = (n) => Math.round(n * 100) / 100;
const clave = (s) => `${s.anio}-${s.semana}`;

/** Medianoche UTC del día de [fecha] (las fechas de la app se guardan así). */
function soloDia(fecha) {
  const d = new Date(fecha);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Semanas desde [desde] hasta [hasta] (inclusive), en orden. */
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

/** Precio por kilo (minorista) registrado para la semana, o null. */
function precioRegistrado(precios, s, inicio, fin) {
  const ordenados = [...precios].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const p = ordenados.find(x => x.semana === s.semana && x.anio === s.anio && +new Date(x.fechaInicio) === +inicio)
    || ordenados.find(x => new Date(x.fechaInicio) <= fin && new Date(x.fechaFin) >= inicio);
  return p?.precioPorKg > 0 ? Number(p.precioPorKg) : null;
}

/**
 * Cálculo puro (sin base de datos) de la cuenta de cada semana.
 * @param {object} d
 *   producciones: [{ fecha, kgProducidos, litrosUsados }]
 *   ventas:       [{ fecha, cantidad, unidad, totalVenta }] (en orden de registro)
 *   traspasos:    [{ semana, anio, kgFinal, mermaRegistradaKg }]  kg que el usuario pasó de esa semana a la
 *                 siguiente y la merma que registró (ausente o null = sin registrar)
 *   precios:      [{ semana, anio, fechaInicio, fechaFin, precioPorKg, createdAt }]
 *   leches:       [{ fecha, litros }]
 *   preciosLitro: [{ semana, anio, precioLitro }]
 *   hoy:          fecha de hoy (día local de la app)
 * @returns semanas en orden (la más antigua primero); la última es la semana en curso.
 */
function cuentaSemanal({ producciones = [], ventas = [], traspasos = [], precios = [], leches = [], preciosLitro = [], hoy = new Date() }) {
  const hoyDia = soloDia(hoy);
  const actual = semanaDeFecha(hoyDia);

  // Desde la primera producción o venta (máximo un año atrás) hasta la semana en curso
  const fechas = [...producciones, ...ventas].map(x => soloDia(x.fecha)).filter(f => f <= rangoSemana(actual.semana, actual.anio).fin);
  if (!fechas.length) fechas.push(hoyDia);
  let desde = semanaDeFecha(new Date(Math.min(...fechas)));
  const limite = semanaDeFecha(new Date(rangoSemana(actual.semana, actual.anio).inicio.getTime() - (MAX_SEMANAS - 1) * 7 * DIA_MS));
  if (rangoSemana(desde.semana, desde.anio).inicio < rangoSemana(limite.semana, limite.anio).inicio) desde = limite;
  const lista = semanasEntre(desde, actual);

  const pasadoDe = Object.fromEntries(traspasos.map(t => [clave(t), Number(t.kgFinal) || 0]));
  const mermaDe = Object.fromEntries(traspasos
    .filter(t => t.mermaRegistradaKg != null && Number.isFinite(Number(t.mermaRegistradaKg)))
    .map(t => [clave(t), Number(t.mermaRegistradaKg)]));
  const litroDe = Object.fromEntries(preciosLitro.map(p => [clave(p), Number(p.precioLitro) || 0]));

  const semanas = lista.map((s, i) => {
    const { inicio, fin } = rangoSemana(s.semana, s.anio);
    const anterior = i > 0 ? lista[i - 1] : semanaDeFecha(new Date(inicio.getTime() - DIA_MS));
    return {
      semana: s.semana, anio: s.anio, fechaInicio: inicio, fechaFin: fin, texto: textoRango(inicio, fin),
      // El lote se termina de vender el viernes siguiente; la merma se completa al terminar ese viernes
      viernesSiguiente: iso(new Date(fin.getTime() + 1)),
      completa: hoyDia.getTime() > fin.getTime() + 1,
      // Desde el viernes siguiente se puede registrar la merma
      cerrada: hoyDia.getTime() > fin.getTime(),
      mermaRegistrada: mermaDe[clave(s)] ?? null,
      stockInicialKg: pasadoDe[clave(anterior)] || 0,
      kgProducidos: 0, litrosUsados: 0,
      kgVendidos: 0, ventas: 0, kgVendidosViernesSiguiente: 0,
      kgPasados: pasadoDe[clave(s)] || 0,
      litrosLeche: 0, costoLitro: litroDe[clave(s)] || 0,
      precioRegistradoKg: precioRegistrado(precios, s, inicio, fin)
    };
  });
  const indice = Object.fromEntries(semanas.map((s, i) => [clave(s), i]));
  const de = (fecha) => { const i = indice[clave(semanaDeFecha(soloDia(fecha)))]; return i === undefined ? null : semanas[i]; };

  for (const p of producciones) {
    const s = de(p.fecha);
    if (s) { s.kgProducidos += Number(p.kgProducidos) || 0; s.litrosUsados += Number(p.litrosUsados) || 0; }
  }
  for (const l of leches) {
    const s = de(l.fecha);
    if (s) s.litrosLeche += Number(l.litros) || 0;
  }

  // Ventas por lote, en orden de fecha (y de registro el mismo día)
  const ordenadas = ventas.map((v, orden) => ({ v, orden, dia: soloDia(v.fecha) }))
    .sort((a, b) => a.dia - b.dia || a.orden - b.orden);
  for (const { v, dia } of ordenadas) {
    const s = de(dia);
    if (!s) continue;
    let kg = aKg(Number(v.cantidad) || 0, v.unidad);
    const total = Number(v.totalVenta) || 0;
    const porKg = kg > 0 ? total / kg : 0;
    const i = indice[clave(s)];
    // Viernes: primero el queso que quedó de la semana que cerró el jueves
    if (dia.getTime() === s.fechaInicio.getTime() && i > 0) {
      const prev = semanas[i - 1];
      const queda = prev.stockInicialKg + prev.kgProducidos - prev.kgVendidos - prev.kgPasados;
      const delAnterior = Math.min(kg, Math.max(0, queda));
      if (delAnterior > 0) {
        prev.kgVendidos += delAnterior;
        prev.kgVendidosViernesSiguiente += delAnterior;
        prev.ventas += delAnterior * porKg;
        kg -= delAnterior;
      }
    }
    if (kg > 0) { s.kgVendidos += kg; s.ventas += kg * porKg; }
  }

  return semanas.map(s => {
    const base = s.stockInicialKg + s.kgProducidos;
    const costoLeche = Math.round(s.litrosLeche * s.costoLitro);
    const ventasTotal = Math.round(s.ventas);
    const precioPromedioKg = s.kgVendidos > 0 ? Math.round(s.ventas / s.kgVendidos) : null;
    const precioMermaKg = precioPromedioKg ?? s.precioRegistradoKg;
    // Lo que sobró del lote (antes de pasar queso) y la merma sugerida (lo que sobró menos lo pasado)
    const sobrante = s.cerrada ? r2(base - s.kgVendidos) : null;
    const sugerida = sobrante == null ? null : r2(Math.max(0, sobrante - s.kgPasados));
    const merma = s.mermaRegistrada == null ? null : r2(s.mermaRegistrada);
    const pendiente = s.cerrada && merma == null && base > 0;
    const mermaPct = merma == null ? null : base > 0 ? Math.round((merma / base) * 1000) / 10 : 0;
    let revisar = null;
    if (sobrante != null && sobrante < -0.005) revisar = 'Se vendió más queso del que hay registrado. Revisa la producción o lo que pasaste de semana.';
    else if (merma != null && sobrante != null && merma + s.kgPasados > sobrante + 0.01) revisar = `La merma (${merma} kg) y lo que pasaste (${r2(s.kgPasados)} kg) suman más de lo que sobró (${sobrante} kg): puede haber ventas nuevas. Corrige la merma.`;
    else if (mermaPct != null && mermaPct > MERMA_REVISAR_PCT) revisar = `La merma pasa del ${MERMA_REVISAR_PCT} %: revisa si falta registrar alguna venta.`;
    return {
      semana: s.semana, anio: s.anio, fechaInicio: s.fechaInicio, fechaFin: s.fechaFin, texto: s.texto,
      viernesSiguiente: s.viernesSiguiente,
      completa: s.completa,
      cerrada: s.cerrada,
      stockInicialKg: r2(s.stockInicialKg),
      kgProducidos: r2(s.kgProducidos),
      litrosUsados: r2(s.litrosUsados),
      kgVendidos: r2(s.kgVendidos),
      kgVendidosViernesSiguiente: r2(s.kgVendidosViernesSiguiente),
      kgPasados: r2(s.kgPasados),
      // Lo que queda del lote por vender (sin restar ninguna merma)
      kgPorVender: r2(Math.max(0, base - s.kgVendidos - s.kgPasados)),
      ventas: ventasTotal,
      litrosLeche: r2(s.litrosLeche),
      costoLitro: s.costoLitro,
      costoLeche,
      ganancia: ventasTotal - costoLeche,
      precioPromedioKg,
      precioRegistradoKg: s.precioRegistradoKg,
      // Merma: solo la registrada por el usuario (null = sin registrar)
      mermaKg: merma,
      mermaPct,
      mermaPendiente: pendiente,
      sobranteKg: sobrante,
      mermaSugeridaKg: sugerida,
      // Valor de la merma (solo si es positiva y hay con qué valorarla)
      precioMermaKg: merma != null ? precioMermaKg : null,
      valorMerma: merma != null && merma > 0 && precioMermaKg ? Math.round(merma * precioMermaKg) : (merma != null ? 0 : null),
      revisar
    };
  });
}

/** % de merma de las semanas con merma registrada: merma total ÷ (inicial + producido) total. */
function promedioPct(semanas) {
  const completas = semanas.filter(s => s.mermaKg != null && s.stockInicialKg + s.kgProducidos > 0);
  const base = completas.reduce((t, s) => t + s.stockInicialKg + s.kgProducidos, 0);
  return base > 0 ? Math.round((completas.reduce((t, s) => t + s.mermaKg, 0) / base) * 1000) / 10 : 0;
}

/** Carga (solo lectura) los datos del usuario y calcula su cuenta semanal. */
async function cuentaDeUsuario(usuarioId, hoy = new Date()) {
  const id = new Types.ObjectId(usuarioId);
  const actual = semanaDeFecha(soloDia(hoy));
  const desde = new Date(rangoSemana(actual.semana, actual.anio).inicio.getTime() - MAX_SEMANAS * 7 * DIA_MS);
  const filtro = { usuarioId: id, fecha: { $gte: desde } };
  const [producciones, ventas, traspasos, precios, leches, preciosLitro] = await Promise.all([
    Produccion.find(filtro).select('fecha kgProducidos litrosUsados').lean(),
    Venta.find(filtro).sort({ fecha: 1, createdAt: 1 }).select('fecha cantidad unidad totalVenta').lean(),
    CierreSemana.find({ usuarioId: id }).select('semana anio kgFinal mermaRegistradaKg').lean(),
    Precio.find({ usuarioId: id, fechaFin: { $gte: desde } }).lean(),
    Leche.find(filtro).select('fecha litros').lean(),
    PrecioLeche.find({ usuarioId: id }).select('semana anio precioLitro').lean()
  ]);
  return cuentaSemanal({ producciones, ventas, traspasos, precios, leches, preciosLitro, hoy });
}

/** Respuesta de GET /api/merma: semanas (la más reciente primero), promedio, semana en curso y queso por vender. */
async function calcularMerma(usuarioId, hoy = new Date()) {
  const semanas = await cuentaDeUsuario(usuarioId, hoy);
  const actual = semanas[semanas.length - 1];
  const previa = semanas[semanas.length - 2];
  // Queso por vender hoy: el lote de la semana en curso y, el viernes, lo que quede de la que cerró el jueves
  const porVenderKg = r2(actual.kgPorVender + (previa && !previa.completa ? previa.kgPorVender : 0));
  return { semanas: semanas.slice().reverse(), promedioPct: promedioPct(semanas), actual, porVenderKg };
}

module.exports = { cuentaSemanal, cuentaDeUsuario, calcularMerma, promedioPct, MERMA_REVISAR_PCT };
