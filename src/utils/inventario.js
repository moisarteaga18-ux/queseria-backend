const { Producto, Movimiento } = require('../models');

/** Error con código HTTP, para responder 400/404 en lugar de 500. */
function errorHttp(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

/**
 * Responde un error de ruta usando su código HTTP (500 si no tiene).
 * `requiereConfirmacion` (409) indica que la app debe preguntar y reenviar con `confirmar: true`.
 */
function responderError(res, e) {
  res.status(e.status || (e.name === 'CastError' || e.name === 'ValidationError' ? 400 : 500))
    .json({ ok: false, error: e.message, ...(e.requiereConfirmacion ? { requiereConfirmacion: true } : {}) });
}

/**
 * Suma [cantidadKg] (negativo = salida) al stock del producto y deja el movimiento en el historial.
 * Las salidas solo se aplican si hay stock suficiente (la condición va en la misma
 * actualización, así dos ventas simultáneas no pueden dejar el stock negativo).
 */
async function registrarMovimiento(usuarioId, { productoId, tipo, cantidadKg, motivo, referencia, fecha }) {
  const filtro = { _id: productoId, usuarioId };
  if (tipo === 'SALIDA') filtro.stockKg = { $gte: -cantidadKg - 0.0001 };

  const producto = await Producto.findOneAndUpdate(filtro, { $inc: { stockKg: cantidadKg } }, { new: true });
  if (!producto) {
    const existe = await Producto.findOne({ _id: productoId, usuarioId });
    if (!existe) throw errorHttp(404, 'Producto no encontrado');
    throw errorHttp(400, `Solo hay ${existe.stockKg.toFixed(2)} kg de ${existe.nombre} en stock`);
  }
  await Movimiento.create({
    usuarioId, productoId, tipo, cantidadKg, motivo,
    referencia: referencia ? String(referencia) : undefined,
    fecha: fecha || new Date()
  });
  return producto;
}

/** Deshace los movimientos de una venta/producción eliminada (devuelve el stock y borra el historial). */
async function revertirReferencia(usuarioId, referencia) {
  const movimientos = await Movimiento.find({ usuarioId, referencia: String(referencia) });
  for (const m of movimientos) {
    await Producto.updateOne({ _id: m.productoId, usuarioId }, { $inc: { stockKg: -m.cantidadKg } });
  }
  await Movimiento.deleteMany({ usuarioId, referencia: String(referencia) });
  return movimientos.length > 0;
}

/**
 * Cambia el movimiento de una venta/producción corregida: deshace el anterior y aplica [nuevo]
 * (o ninguno si es null). Si el nuevo no se puede aplicar (sin stock), deja el anterior como estaba.
 */
async function reemplazarMovimiento(usuarioId, referencia, nuevo) {
  const anteriores = await Movimiento.find({ usuarioId, referencia: String(referencia) }).lean();
  await revertirReferencia(usuarioId, referencia);
  if (!nuevo) return;
  try {
    await registrarMovimiento(usuarioId, { ...nuevo, referencia });
  } catch (e) {
    for (const m of anteriores) {
      await Producto.updateOne({ _id: m.productoId, usuarioId }, { $inc: { stockKg: m.cantidadKg } });
      const { _id, __v, ...copia } = m;
      await Movimiento.create(copia);
    }
    throw e;
  }
}

module.exports = { errorHttp, responderError, registrarMovimiento, revertirReferencia, reemplazarMovimiento };
