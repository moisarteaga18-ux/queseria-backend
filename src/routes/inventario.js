const router = require('express').Router();
const { Producto, Movimiento } = require('../models');
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
// { productoId, tipo: ENTRADA|SALIDA|AJUSTE, cantidadKg, motivo }
// En ENTRADA/SALIDA, cantidadKg es la cantidad (positiva). En AJUSTE es el stock real contado.
router.post('/movimientos', async (req, res) => {
  try {
    const { productoId, tipo } = req.body;
    const cantidad = Number(req.body.cantidadKg);
    if (!['ENTRADA', 'SALIDA', 'AJUSTE'].includes(tipo)) throw errorHttp(400, 'Tipo de movimiento inválido');
    if (!(cantidad >= 0) || (cantidad === 0 && tipo !== 'AJUSTE')) throw errorHttp(400, 'Cantidad inválida');

    let delta = tipo === 'SALIDA' ? -cantidad : cantidad;
    if (tipo === 'AJUSTE') {
      const producto = await Producto.findOne({ _id: productoId, usuarioId: req.usuarioId });
      if (!producto) throw errorHttp(404, 'Producto no encontrado');
      delta = parseFloat((cantidad - producto.stockKg).toFixed(4));
      if (delta === 0) return res.json({ ok: true, data: producto });
    }

    const producto = await registrarMovimiento(req.usuarioId, {
      productoId, tipo, cantidadKg: delta, motivo: textoOpcional(req.body.motivo)
    });
    res.status(201).json({ ok: true, data: producto });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
