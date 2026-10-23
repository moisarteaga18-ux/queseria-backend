const router = require('express').Router();
const { Produccion } = require('../models');
const { responderError, registrarMovimiento, revertirReferencia } = require('../utils/inventario');

router.get('/', async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    const registros = await Produccion.find({ usuarioId: req.usuarioId })
      .sort({ fecha: -1, createdAt: -1 }).limit(Number(limit));
    res.json({ ok: true, data: registros });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/produccion  { fecha, litrosUsados, kgProducidos, observaciones, productoId }
// Con productoId, el queso producido se suma al inventario de ese producto.
router.post('/', async (req, res) => {
  try {
    const { fecha, litrosUsados, kgProducidos, observaciones, productoId } = req.body;
    if (!litrosUsados || !kgProducidos) return res.status(400).json({ ok: false, error: 'Faltan datos' });
    const registro = await Produccion.create({
      usuarioId: req.usuarioId,
      fecha: fecha || new Date(),
      litrosUsados, kgProducidos, observaciones,
      productoId: productoId || undefined
    });
    if (productoId) {
      try {
        await registrarMovimiento(req.usuarioId, {
          productoId, tipo: 'ENTRADA', cantidadKg: Number(kgProducidos),
          motivo: 'Producción', referencia: registro._id, fecha: registro.fecha
        });
      } catch (e) {
        await registro.deleteOne();
        throw e;
      }
    }
    res.status(201).json({ ok: true, data: registro });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/produccion/:id  (si sumó al inventario, se descuenta)
router.delete('/:id', async (req, res) => {
  try {
    const registro = await Produccion.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    if (registro) await revertirReferencia(req.usuarioId, registro._id);
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
