const router = require('express').Router();
const { Leche, Produccion, Venta, Precio } = require('../models');

// GET /api/resumen/hoy
router.get('/hoy', async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    const hoy = new Date();
    const inicio = new Date(hoy.setHours(0,0,0,0));
    const fin = new Date(hoy.setHours(23,59,59,999));

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
      Precio.findOne({ usuarioId, fechaInicio: { $lte: new Date() }, fechaFin: { $gte: new Date() }, activo: true })
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

    res.json({
      ok: true,
      data: {
        litrosHoy: leche[0]?.totalLitros || 0,
        kgProducidosHoy: produccion[0]?.totalKg || 0,
        stockActualKg,
        ventasHoy: ventas,
        totalVentasHoy: ventas.reduce((sum, v) => sum + v.totalVenta, 0),
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

    // Calcular rango de semana actual y anterior
    const hoy = new Date();
    const diaSemana = hoy.getDay() || 7;
    const lunesActual = new Date(hoy);
    lunesActual.setDate(hoy.getDate() - (diaSemana - 1));
    lunesActual.setHours(0, 0, 0, 0);
    const domingoActual = new Date(lunesActual);
    domingoActual.setDate(lunesActual.getDate() + 6);
    domingoActual.setHours(23, 59, 59, 999);

    const lunesAnterior = new Date(lunesActual);
    lunesAnterior.setDate(lunesActual.getDate() - 7);
    const domingoAnterior = new Date(lunesActual);
    domingoAnterior.setDate(lunesActual.getDate() - 1);
    domingoAnterior.setHours(23, 59, 59, 999);

    async function calcularSemana(inicio, fin) {
      const [ingresos, leche, precio] = await Promise.all([
        Venta.aggregate([
          { $match: { usuarioId: new ObjectId(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
          { $group: { _id: null, total: { $sum: '$totalVenta' }, kgVendidos: { $sum: { $cond: [{ $eq: ['$unidad', 'kg'] }, '$cantidad', 0] } } } }
        ]),
        Leche.aggregate([
          { $match: { usuarioId: new ObjectId(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
          { $group: { _id: null, totalLitros: { $sum: '$litros' } } }
        ]),
        Precio.findOne({ usuarioId, fechaInicio: { $lte: fin }, fechaFin: { $gte: inicio } })
      ]);

      const ingresosTotal = ingresos[0]?.total || 0;
      const litrosComprados = leche[0]?.totalLitros || 0;
      const costoLitro = precio?.costoLitroLeche || 0;
      const costoLeche = parseFloat((litrosComprados * costoLitro).toFixed(2));
      const ganancia = parseFloat((ingresosTotal - costoLeche).toFixed(2));

      return {
        rango: { inicio, fin },
        ingresos: ingresosTotal,
        litrosComprados,
        costoLitro,
        costoLeche,
        ganancia,
        precioVentaKg: precio?.precioPorKg || 0
      };
    }

    const semanaActual = await calcularSemana(lunesActual, domingoActual);
    const semanaAnterior = await calcularSemana(lunesAnterior, domingoAnterior);

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

module.exports = router;