const router = require('express').Router();
const { Venta, Precio } = require('../models');

router.get('/', async (req, res) => {
  try {
    const { limit = 50, desde, hasta } = req.query;
    const filter = { usuarioId: req.usuarioId };
    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = new Date(desde);
      if (hasta) filter.fecha.$lte = new Date(hasta);
    }
    const ventas = await Venta.find(filter).sort({ fecha: -1 }).limit(Number(limit));
    res.json({ ok: true, data: ventas });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { fecha, tipoVenta, cliente, cantidad, unidad, precioUnitario } = req.body;
    if (!cantidad || !tipoVenta || !precioUnitario) return res.status(400).json({ ok: false, error: 'Faltan datos' });

    const hoy = new Date(fecha || Date.now());
    const precioActivo = await Precio.findOne({
      usuarioId: req.usuarioId,
      fechaInicio: { $lte: hoy },
      fechaFin: { $gte: hoy },
      activo: true
    });

    const totalVenta = parseFloat((cantidad * precioUnitario).toFixed(2));
    const venta = await Venta.create({
      usuarioId: req.usuarioId,
      fecha: fecha || new Date(),
      tipoVenta, cliente, cantidad, unidad, precioUnitario, totalVenta,
      precioRef: precioActivo?._id
    });
    res.status(201).json({ ok: true, data: venta });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Venta.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
