const router = require('express').Router();
const { Movimiento } = require('../models');
const { errorHttp, responderError, registrarMovimiento, sumarStock } = require('../utils/inventario');
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

/**
 * Movimiento hecho a mano (entrada/salida o stock inicial). Los de una venta o producción
 * (con `referencia`) se corrigen desde la venta o la producción, para que no queden distintos.
 */
async function buscarManual(req) {
  const m = await Movimiento.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
  if (!m) throw errorHttp(404, 'Movimiento no encontrado');
  if (m.referencia) throw errorHttp(400, 'Este movimiento viene de una venta o una producción: corrígelo desde allí');
  if (!['ENTRADA', 'SALIDA'].includes(m.tipo)) throw errorHttp(400, 'Este movimiento no se puede cambiar');
  return m;
}

// PUT /api/inventario/movimientos/:id  { tipo: ENTRADA|SALIDA, cantidadKg (positiva), motivo }
// Corrige un movimiento manual: el stock cambia solo en la diferencia (el producto no cambia).
router.put('/movimientos/:id', async (req, res) => {
  try {
    const m = await buscarManual(req);
    const { tipo } = req.body;
    const cantidad = Number(req.body.cantidadKg);
    if (!['ENTRADA', 'SALIDA'].includes(tipo)) throw errorHttp(400, 'Tipo de movimiento inválido');
    if (!(cantidad > 0)) throw errorHttp(400, 'Cantidad inválida');

    const nuevaKg = tipo === 'SALIDA' ? -cantidad : cantidad;
    const producto = await sumarStock(req.usuarioId, m.productoId, nuevaKg - m.cantidadKg);
    m.tipo = tipo;
    m.cantidadKg = nuevaKg;
    m.motivo = textoOpcional(req.body.motivo);
    await m.save();
    res.json({ ok: true, data: producto });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/inventario/movimientos/:id — elimina un movimiento manual y deshace su efecto en el stock
router.delete('/movimientos/:id', async (req, res) => {
  try {
    const m = await buscarManual(req);
    const producto = await sumarStock(req.usuarioId, m.productoId, -m.cantidadKg);
    await m.deleteOne();
    res.json({ ok: true, data: producto });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
