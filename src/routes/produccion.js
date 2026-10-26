const router = require('express').Router();
const { Produccion } = require('../models');
const { errorHttp, responderError, registrarMovimiento, revertirReferencia, reemplazarMovimiento } = require('../utils/inventario');
const { textoOpcional } = require('../utils/texto');

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

// PUT /api/produccion/:id  { fecha, litrosUsados, kgProducidos, observaciones, productoId }
// Corrige una producción: el inventario se ajusta (sale lo anterior y entra lo nuevo) y el
// rendimiento se recalcula. Merma, Reportes y Ganancias se calculan al consultarlos.
router.put('/:id', async (req, res) => {
  try {
    const registro = await Produccion.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!registro) throw errorHttp(404, 'Producción no encontrada');
    const { fecha, litrosUsados, kgProducidos, observaciones } = req.body;
    if (litrosUsados !== undefined && !(Number(litrosUsados) > 0)) throw errorHttp(400, 'Litros inválidos');
    if (kgProducidos !== undefined && !(Number(kgProducidos) > 0)) throw errorHttp(400, 'Kilos inválidos');
    if (litrosUsados !== undefined) registro.litrosUsados = Number(litrosUsados);
    if (kgProducidos !== undefined) registro.kgProducidos = Number(kgProducidos);
    if (fecha) registro.fecha = new Date(fecha);
    if (observaciones !== undefined) registro.observaciones = textoOpcional(observaciones);
    // productoId: null o "" = ya no se suma al inventario
    if (req.body.productoId !== undefined) registro.productoId = req.body.productoId || undefined;

    await reemplazarMovimiento(req.usuarioId, registro._id, registro.productoId && {
      productoId: registro.productoId, tipo: 'ENTRADA', cantidadKg: registro.kgProducidos,
      motivo: 'Producción', fecha: registro.fecha
    });
    await registro.save(); // recalcula el rendimiento
    res.json({ ok: true, data: registro });
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
