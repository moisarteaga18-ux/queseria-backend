const router = require('express').Router();
const { Leche, Produccion, Venta, Precio } = require('../models');

// GET /api/resumen/hoy
router.get('/hoy', async (req, res) => {
  try {
    const hoy = new Date();
    const inicio = new Date(hoy.setHours(0,0,0,0));
    const fin = new Date(hoy.setHours(23,59,59,999));

    const [leche, produccion, ventas, precioActivo] = await Promise.all([
      Leche.aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin } } },
        { $group: { _id: null, totalLitros: { $sum: '$litros' } } }
      ]),
      Produccion.aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin } } },
        { $group: { _id: null, totalKg: { $sum: '$kgProducidos' } } }
      ]),
      Venta.aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin } } },
        { $group: { _id: '$tipoVenta', totalVenta: { $sum: '$totalVenta' }, count: { $sum: 1 } } }
      ]),
      Precio.findOne({ fechaInicio: { $lte: new Date() }, fechaFin: { $gte: new Date() }, activo: true })
    ]);

    // Stock acumulado: total producido - total vendido (en kg)
    const totalProducidoHistorico = await Produccion.aggregate([
      { $group: { _id: null, total: { $sum: '$kgProducidos' } } }
    ]);
    const totalVendidoKg = await Venta.aggregate([
      { $match: { unidad: 'kg' } },
      { $group: { _id: null, total: { $sum: '$cantidad' } } }
    ]);
    const totalVendidoLibras = await Venta.aggregate([
      { $match: { unidad: 'libras' } },
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

module.exports = router;
