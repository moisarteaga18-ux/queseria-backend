const router = require('express').Router();
const { CierreSemana } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { rangoSemana } = require('../utils/semana');
const { calcularMerma } = require('../utils/merma');
const { vacio } = require('../utils/validar');

// GET /api/merma?fecha=yyyy-MM-dd — cuenta de cada semana (ventas por lote, merma cuando terminó el
// viernes siguiente), promedio de las semanas completas, semana en curso y queso por vender. No escribe nada.
router.get('/', async (req, res) => {
  try {
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    res.json({ ok: true, data: await calcularMerma(req.usuarioId, hoy) });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/merma/:anio/:semana  { kgFinal, fecha } — "Pasar queso a la semana siguiente": kg del queso de esa
// semana que el usuario pasa a la siguiente (0 = no pasa nada / deshacer). Es opcional: solo cuando el
// usuario quiera. Solo para semanas que ya cerraron (pasó su jueves).
router.put('/:anio/:semana', async (req, res) => {
  try {
    const semana = Number(req.params.semana);
    const anio = Number(req.params.anio);
    if (!(semana >= 1 && semana <= 53) || !(anio > 2000)) throw errorHttp(400, 'Semana inválida');
    if (vacio(req.body.kgFinal)) throw errorHttp(400, 'Escribe los kg que pasas a la semana siguiente (0 para no pasar nada)');
    const kgFinal = typeof req.body.kgFinal === 'number' || typeof req.body.kgFinal === 'string' ? Number(req.body.kgFinal) : NaN;
    if (!Number.isFinite(kgFinal)) throw errorHttp(400, 'Los kg que pasas deben ser un número');
    if (kgFinal < 0) throw errorHttp(400, 'Los kg que pasas no pueden ser negativos');

    const hoy = req.body.fecha ? new Date(req.body.fecha) : new Date();
    const { inicio, fin } = rangoSemana(semana, anio);
    if (hoy <= fin) throw errorHttp(400, 'Esa semana todavía no ha cerrado: se puede pasar queso desde el viernes');

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
