const router = require('express').Router();
const { Descuento, Ganadero, Liquidacion } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { rangoSemana, semanaDeFecha } = require('../utils/semana');
const { textoOpcional } = require('../utils/texto');

const TIPOS = ['adelanto', 'prestamo', 'leche_rechazada', 'otro'];

/** Los descuentos de una semana ya pagada no se pueden cambiar (el comprobante ya se entregó). */
async function validarSemanaAbierta(usuarioId, ganaderoId, fecha) {
  const { semana, anio } = semanaDeFecha(fecha);
  const pagada = await Liquidacion.findOne({ usuarioId, ganaderoId, semana, anio, estado: 'pagado' });
  if (pagada) throw errorHttp(400, `La liquidación N° ${pagada.numero} de esa semana ya está pagada`);
}

// GET /api/descuentos?ganaderoId=&semana=&anio=
router.get('/', async (req, res) => {
  try {
    const filtro = { usuarioId: req.usuarioId };
    if (req.query.ganaderoId) filtro.ganaderoId = req.query.ganaderoId;
    if (req.query.semana && req.query.anio) {
      const { inicio, fin } = rangoSemana(Number(req.query.semana), Number(req.query.anio));
      filtro.fecha = { $gte: inicio, $lte: fin };
    }
    const lista = await Descuento.find(filtro).sort({ fecha: -1, createdAt: -1 }).limit(200);
    res.json({ ok: true, data: lista });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/descuentos  { ganaderoId, fecha, tipo, valor, litros, descripcion }
// leche_rechazada se registra en litros (se valoriza al precio del litro de la semana).
router.post('/', async (req, res) => {
  try {
    const { ganaderoId, tipo } = req.body;
    if (!TIPOS.includes(tipo)) throw errorHttp(400, 'Tipo de descuento inválido');
    const ganadero = await Ganadero.findOne({ _id: ganaderoId, usuarioId: req.usuarioId });
    if (!ganadero) throw errorHttp(404, 'Ganadero no encontrado');

    const fecha = req.body.fecha ? new Date(req.body.fecha) : new Date();
    const valor = Number(req.body.valor || 0);
    const litros = Number(req.body.litros || 0);
    if (tipo === 'leche_rechazada' ? !(litros > 0) : !(valor > 0)) {
      throw errorHttp(400, tipo === 'leche_rechazada' ? 'Ingresa los litros rechazados' : 'Ingresa el valor');
    }
    await validarSemanaAbierta(req.usuarioId, ganadero._id, fecha);

    const descuento = await Descuento.create({
      usuarioId: req.usuarioId,
      ganaderoId: ganadero._id,
      fecha, tipo,
      valor: tipo === 'leche_rechazada' ? 0 : valor,
      litros: tipo === 'leche_rechazada' ? litros : undefined,
      descripcion: textoOpcional(req.body.descripcion)
    });
    res.status(201).json({ ok: true, data: descuento });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/descuentos/:id
router.delete('/:id', async (req, res) => {
  try {
    const descuento = await Descuento.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!descuento) return res.json({ ok: true });
    await validarSemanaAbierta(req.usuarioId, descuento.ganaderoId, descuento.fecha);
    await descuento.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
