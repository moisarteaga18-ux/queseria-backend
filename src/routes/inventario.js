const router = require('express').Router();
const { Movimiento } = require('../models');
const { errorHttp, responderError, registrarMovimiento } = require('../utils/inventario');
const { textoOpcional } = require('../utils/texto');

// GET /api/inventario/movimientos?limit=100&productoId=
router.get('/movimientos', async (req, res) => {
  try {
    const { limit = 100, productoId } = req.query;
    const filtro = { usuarioId: req.usuarioId };
    if (productoId) filtro.productoId = productoId;
    const movimientos = await Movimiento.find(filtro)
      .sort({ fecha: -1, _id: -1 })
      .limit(Number(limit))
      .populate('productoId', 'nombre')
      .lean();

    res.json({
      ok: true,
      data: movimientos.map(m => ({
        ...m,
        productoId: m.productoId?._id ?? m.productoId,
        nombreProducto: m.productoId?.nombre ?? 'Producto eliminado'
      }))
    });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/inventario/movimientos
// { productoId, tipo: ENTRADA|SALIDA, cantidadKg (positiva), motivo }
// Ya no hay AJUSTE: la merma no se registra a mano, se calcula sola en el cierre semanal.
router.post('/movimientos', async (req, res) => {
  try {
    const { productoId, tipo } = req.body;
    const cantidad = Number(req.body.cantidadKg);
    if (tipo === 'AJUSTE') throw errorHttp(400, 'La merma ya no se registra a mano: se calcula sola al cierre de cada semana');
    if (!['ENTRADA', 'SALIDA'].includes(tipo)) throw errorHttp(400, 'Tipo de movimiento inválido');
    if (!(cantidad > 0)) throw errorHttp(400, 'Cantidad inválida');

    const producto = await registrarMovimiento(req.usuarioId, {
      productoId, tipo, cantidadKg: tipo === 'SALIDA' ? -cantidad : cantidad, motivo: textoOpcional(req.body.motivo)
    });
    res.status(201).json({ ok: true, data: producto });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
