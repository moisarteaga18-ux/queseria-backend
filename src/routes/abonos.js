// Abonos (pagos parciales o totales) a las ventas fiadas. Cuando los abonos llegan al total, la venta queda pagada.
// Necesitan internet (en la app no van a la cola sin conexión). Borrar deja la copia en la papelera (Deshacer).
const router = require('express').Router();
const { Types } = require('mongoose');
const { Abono } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { positivo } = require('../utils/validar');
const { textoOpcional } = require('../utils/texto');
const { borrarConPapelera } = require('../utils/papelera');
const { ventaFiada, estadoDe, pesos } = require('../utils/cobros');

/** Fecha del abono (yyyy-MM-dd o ISO); sin fecha = hoy. No puede ser anterior a la venta. */
function leerFecha(valor, venta) {
  const fecha = valor ? new Date(valor) : new Date();
  if (Number.isNaN(fecha.getTime())) throw errorHttp(400, 'La fecha del abono no es válida');
  const diaVenta = new Date(venta.fecha);
  diaVenta.setUTCHours(0, 0, 0, 0);
  if (fecha < diaVenta) throw errorHttp(400, 'El abono no puede ser de antes de la venta');
  return fecha;
}

async function abonoDe(req) {
  const abono = Types.ObjectId.isValid(req.params.id) ? await Abono.findOne({ _id: req.params.id, usuarioId: req.usuarioId }) : null;
  if (!abono) throw errorHttp(404, 'Abono no encontrado');
  return abono;
}

/** Respuesta: el abono y cómo quedó la venta (abonado, saldo, pagada). */
async function respuesta(usuarioId, abono, ventaId) {
  const { venta, abonado, saldo, pagada } = await ventaFiada(usuarioId, ventaId);
  return { abono, venta: { _id: venta._id, total: Number(venta.totalVenta), abonado, saldo, pagada } };
}

// GET /api/abonos?ventaId= — abonos de una venta (el más antiguo primero)
router.get('/', async (req, res) => {
  try {
    const { ventaId } = req.query;
    if (!ventaId || !Types.ObjectId.isValid(ventaId)) throw errorHttp(400, 'Falta la venta');
    const abonos = await Abono.find({ usuarioId: req.usuarioId, ventaId }).sort({ fecha: 1, createdAt: 1 });
    res.json({ ok: true, data: abonos });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/abonos { ventaId, fecha, valor, nota } — el valor no puede pasar de lo que falta
router.post('/', async (req, res) => {
  try {
    const { venta, saldo } = await ventaFiada(req.usuarioId, req.body.ventaId);
    const valor = positivo(req.body.valor, 'valor');
    if (saldo <= 0) throw errorHttp(400, 'Esa venta ya está pagada');
    if (valor > saldo + 0.005) throw errorHttp(400, `Solo falta ${pesos(saldo)}: el abono no puede ser mayor`);
    const abono = await Abono.create({
      usuarioId: req.usuarioId, ventaId: venta._id, fecha: leerFecha(req.body.fecha, venta),
      valor, nota: textoOpcional(req.body.nota)
    });
    res.status(201).json({ ok: true, data: await respuesta(req.usuarioId, abono, venta._id) });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/abonos/:id { fecha, valor, nota } — corrige un abono (sin pasar del total de la venta)
router.put('/:id', async (req, res) => {
  try {
    const abono = await abonoDe(req);
    const { venta, abonado } = await ventaFiada(req.usuarioId, abono.ventaId);
    if (req.body.valor !== undefined) {
      const valor = positivo(req.body.valor, 'valor');
      const otros = abonado - Number(abono.valor);
      const { saldo } = estadoDe(venta, otros);
      if (valor > saldo + 0.005) throw errorHttp(400, `Sin este abono faltan ${pesos(saldo)}: el abono no puede ser mayor`);
      abono.valor = valor;
    }
    if (req.body.fecha !== undefined) abono.fecha = leerFecha(req.body.fecha, venta);
    if (req.body.nota !== undefined) abono.nota = textoOpcional(req.body.nota);
    await abono.save();
    res.json({ ok: true, data: await respuesta(req.usuarioId, abono, venta._id) });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/abonos/:id — la copia queda en la papelera (30 días) para "Deshacer"
router.delete('/:id', async (req, res) => {
  try {
    const abono = await Abono.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!abono) return res.json({ ok: true });
    const papeleraId = await borrarConPapelera(req.usuarioId, 'abono', abono);
    res.json({ ok: true, papeleraId, data: { papeleraId } });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
