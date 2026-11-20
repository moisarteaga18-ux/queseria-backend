const router = require('express').Router();
const { borrarConPapelera } = require('../utils/papelera');
const { Venta, Precio, Cliente } = require('../models');
const { errorHttp, responderError, registrarMovimiento, revertirReferencia, reemplazarMovimiento } = require('../utils/inventario');
const { textoOpcional } = require('../utils/texto');
const { positivo } = require('../utils/validar');
const { idLocalDe, yaGuardado, esRepetido } = require('../utils/idLocal');

const { aKg } = require('../utils/unidades');

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
  let idLocal;
  try {
    // Reenvío de una venta hecha sin internet que ya se guardó: se devuelve la misma (no se duplica)
    idLocal = idLocalDe(req);
    const previa = await yaGuardado(Venta, req, idLocal);
    if (previa) return res.json({ ok: true, repetido: true, data: previa });
    const { fecha, tipoVenta, clienteId, productoId, unidad } = req.body;
    if (!tipoVenta) throw errorHttp(400, 'Elige el tipo de venta (mayorista o minorista)');
    const cantidad = positivo(req.body.cantidad, 'cantidad');
    const precioUnitario = positivo(req.body.precioUnitario, 'precioUnitario');

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
      precioRef: precioActivo?._id,
      idLocal
    });

    if (productoId) {
      const kg = aKg(cantidad, unidad);
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
    if (esRepetido(e)) {
      const previa = await yaGuardado(Venta, req, idLocal);
      if (previa) return res.json({ ok: true, repetido: true, data: previa });
    }
    responderError(res, e);
  }
});

// PUT /api/ventas/:id  (mismos datos que POST) — corrige una venta. El inventario se ajusta:
// vuelve el queso de la venta anterior y sale el de la corregida (si no alcanza el stock, no cambia nada).
router.put('/:id', async (req, res) => {
  try {
    const venta = await Venta.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!venta) throw errorHttp(404, 'Venta no encontrada');
    const b = req.body;
    if (b.tipoVenta !== undefined) venta.tipoVenta = b.tipoVenta;
    if (b.unidad !== undefined) venta.unidad = b.unidad;
    if (b.fecha) venta.fecha = new Date(b.fecha);
    if (b.cantidad !== undefined) venta.cantidad = positivo(b.cantidad, 'cantidad');
    if (b.precioUnitario !== undefined) venta.precioUnitario = positivo(b.precioUnitario, 'precioUnitario');
    if (b.clienteId !== undefined || b.cliente !== undefined) {
      let cliente = textoOpcional(b.cliente);
      venta.clienteId = undefined;
      if (b.clienteId) {
        const c = await Cliente.findOne({ _id: b.clienteId, usuarioId: req.usuarioId });
        if (!c) throw errorHttp(404, 'Cliente no encontrado');
        cliente = c.nombre;
        venta.clienteId = c._id;
      }
      venta.cliente = cliente;
    }
    if (b.productoId !== undefined) venta.productoId = b.productoId || undefined;
    venta.totalVenta = parseFloat((venta.cantidad * venta.precioUnitario).toFixed(2));
    await venta.validate();

    await reemplazarMovimiento(req.usuarioId, venta._id, venta.productoId && {
      productoId: venta.productoId, tipo: 'SALIDA',
      cantidadKg: -aKg(venta.cantidad, venta.unidad),
      motivo: 'Venta' + (venta.cliente ? ` a ${venta.cliente}` : ''), fecha: venta.fecha
    });
    await venta.save();
    res.json({ ok: true, data: venta });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/ventas/:id  (si descontó inventario, el queso vuelve al stock)
router.delete('/:id', async (req, res) => {
  try {
    const venta = await Venta.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!venta) return res.json({ ok: true });
    // Queda una copia en la papelera (30 días) para "Deshacer" o restaurarla
    const papeleraId = await borrarConPapelera(req.usuarioId, 'venta', venta);
    await revertirReferencia(req.usuarioId, venta._id);
    res.json({ ok: true, papeleraId, data: { papeleraId } });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
