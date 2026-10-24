const router = require('express').Router();
const { Leche, Ganadero } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { textoOpcional } = require('../utils/texto');

// GET /api/leche?limit=30&fecha=&desde=&hasta=&ganaderoId=
router.get('/', async (req, res) => {
  try {
    const { limit = 30, fecha, desde, hasta, ganaderoId } = req.query;
    const filter = { usuarioId: req.usuarioId };
    if (fecha) {
      const d = new Date(fecha);
      filter.fecha = { $gte: new Date(d.setHours(0,0,0,0)), $lte: new Date(d.setHours(23,59,59,999)) };
    } else if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = new Date(desde);
      if (hasta) filter.fecha.$lte = new Date(hasta);
    }
    if (ganaderoId) filter.ganaderoId = ganaderoId;
    const registros = await Leche.find(filter).sort({ fecha: -1, createdAt: -1 }).limit(Number(limit));
    res.json({ ok: true, data: registros });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/leche  { fecha, litros, ganaderoId, observaciones }
router.post('/', async (req, res) => {
  try {
    const { fecha, litros, ganaderoId, observaciones } = req.body;
    if (!litros || litros <= 0) return res.status(400).json({ ok: false, error: 'Litros inválidos' });

    let proveedor = textoOpcional(req.body.proveedor);
    if (ganaderoId) {
      const ganadero = await Ganadero.findOne({ _id: ganaderoId, usuarioId: req.usuarioId });
      if (!ganadero) throw errorHttp(404, 'Ganadero no encontrado');
      proveedor = ganadero.nombre;
    }
    const registro = await Leche.create({
      usuarioId: req.usuarioId,
      fecha: fecha || new Date(),
      litros,
      ganaderoId: ganaderoId || undefined,
      proveedor,
      observaciones: textoOpcional(observaciones)
    });
    res.status(201).json({ ok: true, data: registro });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/leche/:id  { fecha, litros, ganaderoId, observaciones } — corregir un registro
// (por ejemplo, asignarle el ganadero a un registro antiguo que no lo tenía)
router.put('/:id', async (req, res) => {
  try {
    const registro = await Leche.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!registro) throw errorHttp(404, 'Registro no encontrado');
    const { fecha, litros, ganaderoId, observaciones } = req.body;
    if (litros !== undefined) {
      if (!(Number(litros) > 0)) throw errorHttp(400, 'Litros inválidos');
      registro.litros = Number(litros);
    }
    if (fecha) registro.fecha = new Date(fecha);
    if (ganaderoId) {
      const ganadero = await Ganadero.findOne({ _id: ganaderoId, usuarioId: req.usuarioId });
      if (!ganadero) throw errorHttp(404, 'Ganadero no encontrado');
      registro.ganaderoId = ganadero._id;
      registro.proveedor = ganadero.nombre;
    }
    if (observaciones !== undefined) registro.observaciones = textoOpcional(observaciones);
    await registro.save();
    res.json({ ok: true, data: registro });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/leche/:id
router.delete('/:id', async (req, res) => {
  try {
    await Leche.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
