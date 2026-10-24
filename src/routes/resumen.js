const router = require('express').Router();
const { Leche, Produccion, Venta, Precio, PrecioLeche } = require('../models');
const { semanaDeFecha, semanaDeQuery, semanaAnterior: semanaPrevia, rangoSemana, textoRango } = require('../utils/semana');

/**
 * Precio semanal (queso) de una semana: el registrado con ese número de semana o,
 * para precios guardados antes del corte viernes–jueves, el que se cruce con sus fechas.
 */
async function precioDeSemana(usuarioId, semana, anio, inicio, fin) {
  return (await Precio.findOne({ usuarioId, semana, anio, fechaInicio: inicio }).sort({ createdAt: -1 }))
    || Precio.findOne({ usuarioId, fechaInicio: { $lte: fin }, fechaFin: { $gte: inicio } }).sort({ createdAt: -1 });
}

/**
 * Costo del litro de leche para la semana de [fecha]: el precio que se paga a los ganaderos
 * (Pagos) y, si no se definió, el costoLitroLeche del precio semanal.
 */
async function costoLitroDeSemana(usuarioId, fecha, precio) {
  const { semana, anio } = semanaDeFecha(fecha);
  const precioLeche = await PrecioLeche.findOne({ usuarioId, semana, anio });
  return precioLeche?.precioLitro ?? precio?.costoLitroLeche ?? 0;
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
    const vendidoLibrasEnKg = (totalVendidoLibras[0]?.total || 0) / 2.2046;
    const stockActualKg = parseFloat((producidoTotal - vendidoKg - vendidoLibrasEnKg).toFixed(2));

    const litrosHoy = leche[0]?.totalLitros || 0;
    const totalVentasHoy = ventas.reduce((sum, v) => sum + v.totalVenta, 0);
    const costoLecheHoy = parseFloat((litrosHoy * await costoLitroDeSemana(usuarioId, inicio, precioActivo)).toFixed(2));

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
        precioActivo: precioActivo || null
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/resumen/ganancias - compara semana actual vs anterior
router.get('/ganancias', async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    const ObjectId = require('mongoose').Types.ObjectId;

    // Semana actual (viernes a jueves; ?fecha= es el día local del teléfono) y la anterior
    const actual = semanaDeQuery(req.query);
    const anterior = semanaPrevia(actual.semana, actual.anio);

    async function calcularSemana({ semana, anio }) {
      const { inicio, fin } = rangoSemana(semana, anio);
      const [ingresos, leche, precio] = await Promise.all([
        Venta.aggregate([
          { $match: { usuarioId: new ObjectId(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
          { $group: { _id: null, total: { $sum: '$totalVenta' }, kgVendidos: { $sum: { $cond: [{ $eq: ['$unidad', 'kg'] }, '$cantidad', 0] } } } }
        ]),
        Leche.aggregate([
          { $match: { usuarioId: new ObjectId(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
          { $group: { _id: null, totalLitros: { $sum: '$litros' } } }
        ]),
        precioDeSemana(usuarioId, semana, anio, inicio, fin)
      ]);

      const ingresosTotal = ingresos[0]?.total || 0;
      const litrosComprados = leche[0]?.totalLitros || 0;
      const costoLitro = await costoLitroDeSemana(usuarioId, inicio, precio);
      const costoLeche = parseFloat((litrosComprados * costoLitro).toFixed(2));
      const ganancia = parseFloat((ingresosTotal - costoLeche).toFixed(2));

      return {
        semana, anio,
        rango: { inicio, fin, texto: textoRango(inicio, fin) },
        ingresos: ingresosTotal,
        litrosComprados,
        costoLitro,
        costoLeche,
        ganancia,
        precioVentaKg: precio?.precioPorKg || 0
      };
    }

    const semanaActual = await calcularSemana(actual);
    const semanaAnterior = await calcularSemana(anterior);

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

// GET /api/resumen/semanas?n=8 — serie de las últimas n semanas viernes–jueves (gráficos de Reportes)
router.get('/semanas', async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    const ObjectId = require('mongoose').Types.ObjectId;
    const n = Math.min(Math.max(Number(req.query.n) || 8, 1), 26);
    const actual = semanaDeFecha(req.query.fecha ? new Date(req.query.fecha) : new Date());
    const inicioActual = rangoSemana(actual.semana, actual.anio).inicio;

    const semanas = [];
    for (let i = n - 1; i >= 0; i--) {
      const inicio = new Date(inicioActual.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const fin = new Date(inicio.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
      const { semana, anio } = semanaDeFecha(inicio);
      const match = { usuarioId: new ObjectId(usuarioId), fecha: { $gte: inicio, $lte: fin } };

      const [ventas, leche, produccion, precio] = await Promise.all([
        Venta.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$totalVenta' } } }]),
        Leche.aggregate([{ $match: match }, { $group: { _id: null, litros: { $sum: '$litros' } } }]),
        Produccion.aggregate([{ $match: match }, { $group: { _id: null, kg: { $sum: '$kgProducidos' }, litros: { $sum: '$litrosUsados' } } }]),
        precioDeSemana(usuarioId, semana, anio, inicio, fin)
      ]);
      const ingresos = ventas[0]?.total || 0;
      const litros = leche[0]?.litros || 0;
      const costoLeche = parseFloat((litros * await costoLitroDeSemana(usuarioId, inicio, precio)).toFixed(2));
      const kg = produccion[0]?.kg || 0;
      const litrosUsados = produccion[0]?.litros || 0;
      semanas.push({
        semana, anio,
        fechaInicio: inicio,
        fechaFin: fin,
        ingresos,
        litrosLeche: litros,
        costoLeche,
        ganancia: parseFloat((ingresos - costoLeche).toFixed(2)),
        kgProducidos: kg,
        // Libras de queso por lata (20 L) de leche usada
        librasPorLata: litrosUsados > 0 ? parseFloat((kg * 2.2046 / (litrosUsados / 20)).toFixed(2)) : 0
      });
    }
    res.json({ ok: true, data: semanas });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;