const router = require('express').Router();
const { Papelera } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { restaurar } = require('../utils/papelera');

// GET /api/papelera — lo borrado en los últimos 30 días (lo más reciente primero)
router.get('/', async (req, res) => {
  try {
    const lista = await Papelera.find({ usuarioId: req.usuarioId, expiraEn: { $gt: new Date() } })
      .sort({ borradoEn: -1 }).limit(300).lean();
    res.json({
      ok: true,
      data: lista.map(e => ({
        _id: e._id, tipo: e.tipo, resumen: e.resumen, borradoEn: e.borradoEn, expiraEn: e.expiraEn,
        registroId: e.documento?._id
      }))
    });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/papelera/:id/restaurar  { confirmar } — vuelve a crear el registro (también es el "Deshacer").
// Leche de una semana ya pagada pide confirmación (409 requiereConfirmacion) como al registrarla.
router.post('/:id/restaurar', async (req, res) => {
  try {
    const entrada = await Papelera.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!entrada || entrada.expiraEn <= new Date()) throw errorHttp(404, 'Ya no está en la papelera');
    const doc = await restaurar(req, entrada);
    res.json({ ok: true, data: { tipo: entrada.tipo, registro: doc } });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
