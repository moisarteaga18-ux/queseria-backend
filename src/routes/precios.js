const router = require('express').Router();
const { Precio } = require('../models');

// GET /api/precios/actual
router.get('/actual', async (req, res) => {
  try {
    const hoy = new Date();
    const precio = await Precio.findOne({
      usuarioId: req.usuarioId,
      fechaInicio: { $lte: hoy },
      fechaFin: { $gte: hoy },
      activo: true
    }).sort({ createdAt: -1 });
    if (!precio) return res.status(404).json({ ok: false, error: 'No hay precio activo esta semana' });
    res.json({ ok: true, data: precio });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/precios
router.get('/', async (req, res) => {
  try {
    const precios = await Precio.find({ usuarioId: req.usuarioId })
      .sort({ fechaInicio: -1 }).limit(20);
    res.json({ ok: true, data: precios });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/precios
router.post('/', async (req, res) => {
  try {
    const { semana, anio, fechaInicio, fechaFin, precioPorKg, costoLitroLeche } = req.body;
    if (!precioPorKg || precioPorKg <= 0) return res.status(400).json({ ok: false, error: 'Precio inválido' });

    await Precio.updateMany({ usuarioId: req.usuarioId, activo: true }, { activo: false });
    const precio = await Precio.create({
      usuarioId: req.usuarioId,
      semana, anio, fechaInicio, fechaFin, precioPorKg,
      costoLitroLeche: costoLitroLeche || 0,
      activo: true
    });
    res.status(201).json({ ok: true, data: precio });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;