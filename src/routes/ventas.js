const router = require('express').Router();
const { Venta, Precio, Cliente } = require('../models');
const { errorHttp, responderError, registrarMovimiento, revertirReferencia } = require('../utils/inventario');
const { textoOpcional } = require('../utils/texto');

const LIBRAS_POR_KG = 2.2046;

router.get('/', async (req, res) => {
  try {
    const { limit = 50, desde, hasta, clienteId } = req.query;
    const filter = { usuarioId: req.usuarioId };
    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = new Date(desde);
      if (hasta) filter.fecha.$lte = new Date(hasta);
    }
    if (clienteId) filter.clienteId = clienteId;
    const ventas = await Venta.find(filter).sort({ fecha: -1, createdAt: -1 }).limit(Number(limit));
    res.json({ ok: true, data: ventas });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/ventas
// { fecha, tipoVenta: mayorista|libras, cliente, clienteId, productoId, cantidad, unidad: kg|libras, precioUnitario }
// Con productoId, la cantidad se descuenta del inventario (falla si no hay stock suficiente).
router.post('/', async (req, res) => {
  try {
    const { fecha, tipoVenta, clienteId, productoId, cantidad, unidad, precioUnitario } = req.body;
    if (!cantidad || !tipoVenta || !precioUnitario) return res.status(400).json({ ok: false, error: 'Faltan datos' });

    let cliente = textoOpcional(req.body.cliente);
    if (clienteId) {
      const c = await Cliente.findOne({ _id: clienteId, usuarioId: req.usuarioId });
      if (!c) throw errorHttp(404, 'Cliente no encontrado');
      cliente = c.nombre;
    }

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
      clienteId: clienteId || undefined,
      productoId: productoId || undefined,
      precioRef: precioActivo?._id
    });

    if (productoId) {
      const kg = unidad === 'libras' ? cantidad / LIBRAS_POR_KG : Number(cantidad);
      try {
        await registrarMovimiento(req.usuarioId, {
          productoId, tipo: 'SALIDA', cantidadKg: -kg,
          motivo: 'Venta' + (cliente ? ` a ${cliente}` : ''),
          referencia: venta._id, fecha: venta.fecha
        });
      } catch (e) {
        // Sin stock suficiente: la venta no queda registrada
        await venta.deleteOne();
        throw e;
      }
    }
    res.status(201).json({ ok: true, data: venta });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/ventas/:id  (si descontó inventario, el queso vuelve al stock)
router.delete('/:id', async (req, res) => {
  try {
    const venta = await Venta.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    if (venta) await revertirReferencia(req.usuarioId, venta._id);
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
