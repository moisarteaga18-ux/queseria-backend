const router = require('express').Router();
const { Leche, Produccion, Venta, Precio, PrecioLeche } = require('../models');
const { semanaDeFecha, semanaDeQuery, semanaAnterior: semanaPrevia, rangoSemana, textoRango } = require('../utils/semana');
const { cuentaDeUsuario } = require('../utils/merma');
const { porCobrarPorSemana, cuentasPorCobrar } = require('../utils/cobros');
const { LIBRAS_POR_KG, librasPorLata } = require('../utils/unidades');

/**
 * Cuenta de una semana (utils/merma.js: ventas por lote, ganancia y merma) en el formato de Ganancias.
 * Si la semana no tiene movimientos (o es anterior al primer registro), todo va en 0.
 */
function cuentaDe(lista, { semana, anio }) {
  const { inicio, fin } = rangoSemana(semana, anio);
  const c = lista.find(s => s.semana === semana && s.anio === anio) || {
    semana, anio, completa: true, stockInicialKg: 0, kgProducidos: 0, litrosUsados: 0, kgVendidos: 0,
    kgVendidosViernesSiguiente: 0, kgPasados: 0, kgPorVender: 0, ventas: 0, litrosLeche: 0, costoLitro: 0,
    costoLeche: 0, ganancia: 0, precioPromedioKg: null, precioRegistradoKg: null, mermaKg: 0, mermaPct: 0,
    precioMermaKg: null, valorMerma: 0, revisar: null,
    viernesSiguiente: new Date(fin.getTime() + 1).toISOString().slice(0, 10)
  };
  return {
    ...c,
    rango: { inicio, fin, texto: textoRango(inicio, fin) },
    // Nombres que ya usaba la app
    ingresos: c.ventas,
    litrosComprados: c.litrosLeche,
    precioVentaKg: c.precioMermaKg || 0,
    mermaEstimada: false
  };
}

/**
 * Precio semanal (queso) de una semana: el registrado con ese número de semana o,
 * para precios guardados antes del corte viernes–jueves, el que se cruce con sus fechas.
 */
async function precioDeSemana(usuarioId, semana, anio, inicio, fin) {
  return (await Precio.findOne({ usuarioId, semana, anio, fechaInicio: inicio }).sort({ createdAt: -1 }))
    || Precio.findOne({ usuarioId, fechaInicio: { $lte: fin }, fechaFin: { $gte: inicio } }).sort({ createdAt: -1 });
}

/** Costo del litro de leche de la semana de [fecha]: el precio del litro (Precios / liquidaciones), 0 si no hay. */
async function costoLitroDeSemana(usuarioId, fecha) {
  const { semana, anio } = semanaDeFecha(fecha);
  return (await PrecioLeche.findOne({ usuarioId, semana, anio }))?.precioLitro ?? 0;
}

// GET /api/resumen/hoy?fecha=yyyy-MM-dd  (la app manda su fecha local; sin ella se usa la del servidor)
router.get('/hoy', async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    let inicio, fin;
    if (req.query.fecha) {
      inicio = new Date(req.query.fecha);
      fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else {
      const hoy = new Date();
      inicio = new Date(hoy.setHours(0,0,0,0));
      fin = new Date(hoy.setHours(23,59,59,999));
    }

    const [leche, produccion, ventas, precioActivo] = await Promise.all([
      Leche.aggregate([
        { $match: { usuarioId: new (require('mongoose').Types.ObjectId)(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
        { $group: { _id: null, totalLitros: { $sum: '$litros' } } }
      ]),
      Produccion.aggregate([
        { $match: { usuarioId: new (require('mongoose').Types.ObjectId)(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
        { $group: { _id: null, totalKg: { $sum: '$kgProducidos' } } }
      ]),
      Venta.aggregate([
        { $match: { usuarioId: new (require('mongoose').Types.ObjectId)(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
        { $group: { _id: '$tipoVenta', totalVenta: { $sum: '$totalVenta' }, count: { $sum: 1 } } }
      ]),
      (() => {
        const { semana, anio } = semanaDeFecha(inicio);
        const r = rangoSemana(semana, anio);
        return precioDeSemana(usuarioId, semana, anio, r.inicio, r.fin);
      })()
    ]);

    const totalProducidoHistorico = await Produccion.aggregate([
      { $match: { usuarioId: new (require('mongoose').Types.ObjectId)(usuarioId) } },
      { $group: { _id: null, total: { $sum: '$kgProducidos' } } }
    ]);
    const totalVendidoKg = await Venta.aggregate([
      { $match: { usuarioId: new (require('mongoose').Types.ObjectId)(usuarioId), unidad: 'kg' } },
      { $group: { _id: null, total: { $sum: '$cantidad' } } }
    ]);
    const totalVendidoLibras = await Venta.aggregate([
      { $match: { usuarioId: new (require('mongoose').Types.ObjectId)(usuarioId), unidad: 'libras' } },
      { $group: { _id: null, total: { $sum: '$cantidad' } } }
    ]);
    const producidoTotal = totalProducidoHistorico[0]?.total || 0;
    const vendidoKg = totalVendidoKg[0]?.total || 0;
    const vendidoLibrasEnKg = (totalVendidoLibras[0]?.total || 0) / LIBRAS_POR_KG;
    const stockActualKg = parseFloat((producidoTotal - vendidoKg - vendidoLibrasEnKg).toFixed(2));

    const litrosHoy = leche[0]?.totalLitros || 0;
    const totalVentasHoy = ventas.reduce((sum, v) => sum + v.totalVenta, 0);
    const costoLecheHoy = parseFloat((litrosHoy * await costoLitroDeSemana(usuarioId, inicio)).toFixed(2));

    res.json({
      ok: true,
      data: {
        litrosHoy,
        kgProducidosHoy: produccion[0]?.totalKg || 0,
        stockActualKg,
        ventasHoy: ventas,
        totalVentasHoy,
        numeroVentasHoy: ventas.reduce((sum, v) => sum + v.count, 0),
        costoLecheHoy,
        gananciaEstimadaHoy: parseFloat((totalVentasHoy - costoLecheHoy).toFixed(2)),
        precioActivo: precioActivo || null,
        // Lo que te deben hoy (todas las ventas fiadas con saldo)
        porCobrarTotal: (await cuentasPorCobrar(usuarioId)).total
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/resumen/ganancias?fecha=yyyy-MM-dd[&semana=&anio=] — una semana (la de hoy o la elegida) contra
// la anterior. Ganancia = ventas del queso de la semana (por lote: incluye las del viernes siguiente)
// − leche de la semana. La merma y la ganancia se completan al terminar el viernes siguiente (`completa`).
router.get('/ganancias', async (req, res) => {
  try {
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const elegida = semanaDeQuery(req.query);
    const anterior = semanaPrevia(elegida.semana, elegida.anio);
    const [lista, porCobrar] = await Promise.all([cuentaDeUsuario(req.usuarioId, hoy), porCobrarPorSemana(req.usuarioId)]);

    // Lo que falta por cobrar de las ventas de la semana (ventas fiadas): aparte, no cambia ventas ni ganancia
    const semanaActual = { ...cuentaDe(lista, elegida), porCobrar: porCobrar.get(`${elegida.anio}-${elegida.semana}`) || 0 };
    const semanaAnterior = { ...cuentaDe(lista, anterior), porCobrar: porCobrar.get(`${anterior.anio}-${anterior.semana}`) || 0 };

    const variacion = semanaActual.ganancia - semanaAnterior.ganancia;
    const porcentaje = semanaAnterior.ganancia > 0
      ? parseFloat(((variacion / semanaAnterior.ganancia) * 100).toFixed(1))
      : 0;

    res.json({
      ok: true,
      data: { semanaActual, semanaAnterior, variacion, porcentaje }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/resumen/semanas?n=8[&hasta=yyyy-MM-dd] — serie de n semanas viernes–jueves (tablas y gráficos de
// Reportes) que termina en la semana de `hasta` (sin `hasta`, o si es futura: la semana de hoy). `fecha` = hoy.
router.get('/semanas', async (req, res) => {
  try {
    const n = Math.min(Math.max(Number(req.query.n) || 8, 1), 26);
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const deHoy = semanaDeFecha(hoy);
    const inicioHoy = rangoSemana(deHoy.semana, deHoy.anio).inicio;
    const hasta = req.query.hasta ? new Date(req.query.hasta) : null;
    if (hasta && Number.isNaN(hasta.getTime())) return res.status(400).json({ ok: false, error: 'Fecha "hasta" inválida' });
    const actual = hasta && hasta < inicioHoy ? semanaDeFecha(hasta) : deHoy;
    const inicioActual = rangoSemana(actual.semana, actual.anio).inicio;
    const [lista, porCobrar] = await Promise.all([cuentaDeUsuario(req.usuarioId, hoy), porCobrarPorSemana(req.usuarioId)]);

    // Mismas cuentas que Ganancias: ingresos = ventas del queso de cada semana (por lote)
    const semanas = [];
    for (let i = n - 1; i >= 0; i--) {
      const c = cuentaDe(lista, semanaDeFecha(new Date(inicioActual.getTime() - i * 7 * 24 * 60 * 60 * 1000)));
      semanas.push({
        semana: c.semana, anio: c.anio,
        fechaInicio: c.rango.inicio,
        fechaFin: c.rango.fin,
        completa: c.completa,
        ingresos: c.ventas,
        litrosLeche: c.litrosLeche,
        costoLeche: c.costoLeche,
        ganancia: c.ganancia,
        kgProducidos: c.kgProducidos,
        kgVendidos: c.kgVendidos,
        // Libras de queso por lata (20 L) de leche usada
        librasPorLata: librasPorLata(c.kgProducidos, c.litrosUsados),
        mermaKg: c.mermaKg,
        mermaPct: c.mermaPct,
        valorMerma: c.valorMerma,
        // Lo que falta por cobrar (hoy) de las ventas fiadas de esa semana
        porCobrar: porCobrar.get(`${c.anio}-${c.semana}`) || 0,
        revisar: c.revisar,
        mermaEstimada: false
      });
    }
    res.json({ ok: true, data: semanas });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;