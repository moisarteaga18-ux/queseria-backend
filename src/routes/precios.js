const router = require('express').Router();
const { Precio } = require('../models');

// GET /api/precios/actual  → precio vigente hoy
router.get('/actual', async (req, res) => {
  try {
    const hoy = new Date();
    const precio = await Precio.findOne({
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

// GET /api/precios → historial de precios
router.get('/', async (req, res) => {
  try {
    const precios = await Precio.find().sort({ fechaInicio: -1 }).limit(20);
    res.json({ ok: true, data: precios });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/precios → registrar precio de la semana
router.post('/', async (req, res) => {
  try {
    const { semana, anio, fechaInicio, fechaFin, precioPorKg } = req.body;
    if (!precioPorKg || precioPorKg <= 0) return res.status(400).json({ ok: false, error: 'Precio inválido' });
    // Desactivar precio anterior si se traslapa
    await Precio.updateMany({ activo: true }, { activo: false });
    const precio = await Precio.create({ semana, anio, fechaInicio, fechaFin, precioPorKg, activo: true });
    res.status(201).json({ ok: true, data: precio });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
