const router = require('express').Router();
const { Leche } = require('../models');

// GET /api/leche
router.get('/', async (req, res) => {
  try {
    const { limit = 30, fecha } = req.query;
    const filter = { usuarioId: req.usuarioId };
    if (fecha) {
      const d = new Date(fecha);
      filter.fecha = { $gte: new Date(d.setHours(0,0,0,0)), $lte: new Date(d.setHours(23,59,59,999)) };
    }
    const registros = await Leche.find(filter).sort({ fecha: -1 }).limit(Number(limit));
    res.json({ ok: true, data: registros });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/leche
router.post('/', async (req, res) => {
  try {
    const { fecha, litros, proveedor, observaciones } = req.body;
    if (!litros || litros <= 0) return res.status(400).json({ ok: false, error: 'Litros inválidos' });
    const registro = await Leche.create({
      usuarioId: req.usuarioId,
      fecha: fecha || new Date(),
      litros, proveedor, observaciones
    });
    res.status(201).json({ ok: true, data: registro });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/leche/:id
router.delete('/:id', async (req, res) => {
  try {
    await Leche.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
