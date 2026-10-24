const router = require('express').Router();
const { CierreSemana } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { rangoSemana } = require('../utils/semana');
const { calcularMerma } = require('../utils/merma');

// GET /api/merma?fecha=yyyy-MM-dd — merma por semana, promedio, stock estimado de la semana en curso
// y, si aplica, la semana recién cerrada de la que hay que confirmar cuánto queso sobró.
router.get('/', async (req, res) => {
  try {
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    res.json({ ok: true, data: await calcularMerma(req.usuarioId, hoy) });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/merma/:anio/:semana  { kgFinal, fecha } — kg de queso que pasan a la semana siguiente.
// Es el único dato que se pide al cierre (0 si se vendió todo).
router.put('/:anio/:semana', async (req, res) => {
  try {
    const semana = Number(req.params.semana);
    const anio = Number(req.params.anio);
    if (!(semana >= 1 && semana <= 53) || !(anio > 2000)) throw errorHttp(400, 'Semana inválida');
    const kgFinal = Number(req.body.kgFinal);
    if (!(kgFinal >= 0)) throw errorHttp(400, 'Ingresa los kg que pasan a la semana siguiente (0 si no sobró)');

    const hoy = req.body.fecha ? new Date(req.body.fecha) : new Date();
    const { inicio, fin } = rangoSemana(semana, anio);
    if (hoy <= fin) throw errorHttp(400, 'La semana todavía no ha cerrado (el corte es el jueves)');

    await CierreSemana.findOneAndUpdate(
      { usuarioId: req.usuarioId, semana, anio },
      { kgFinal, confirmado: true, $setOnInsert: { fechaInicio: inicio, fechaFin: fin } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, data: await calcularMerma(req.usuarioId, hoy) });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
