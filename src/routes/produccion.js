const router = require('express').Router();
const { Produccion } = require('../models');

router.get('/', async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    const registros = await Produccion.find({ usuarioId: req.usuarioId })
      .sort({ fecha: -1 }).limit(Number(limit));
    res.json({ ok: true, data: registros });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { fecha, litrosUsados, kgProducidos, observaciones } = req.body;
    if (!litrosUsados || !kgProducidos) return res.status(400).json({ ok: false, error: 'Faltan datos' });
    const registro = await Produccion.create({
      usuarioId: req.usuarioId,
      fecha: fecha || new Date(),
      litrosUsados, kgProducidos, observaciones
    });
    res.status(201).json({ ok: true, data: registro });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Produccion.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
