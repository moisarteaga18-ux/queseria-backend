const router = require('express').Router();
const { Precio } = require('../models');
const { semanaDeFecha, semanaDeQuery, rangoSemana } = require('../utils/semana');

// GET /api/precios/actual?fecha=yyyy-MM-dd — precio de la semana (viernes a jueves) que contiene esa fecha
router.get('/actual', async (req, res) => {
  try {
    const { semana, anio } = semanaDeQuery(req.query);
    const { inicio, fin } = rangoSemana(semana, anio);
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const precio = await Precio.findOne({ usuarioId: req.usuarioId, semana, anio, fechaInicio: inicio })
      .sort({ createdAt: -1 })
      // Precios guardados antes del corte viernes–jueves
      || await Precio.findOne({
        usuarioId: req.usuarioId,
        fechaInicio: { $lte: hoy },
        fechaFin: { $gte: hoy },
        activo: true
      }).sort({ createdAt: -1 });
    if (!precio) return res.status(404).json({ ok: false, error: 'No hay precio para esta semana' });
    res.json({ ok: true, data: precio });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/precios
router.get('/', async (req, res) => {
  try {
    const precios = await Precio.find({ usuarioId: req.usuarioId })
      .sort({ fechaInicio: -1, createdAt: -1 }).limit(20);
    res.json({ ok: true, data: precios });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/precios  { semana, anio, precioPorKg, costoLitroLeche }
// Las fechas de la semana (viernes a jueves) las calcula el servidor a partir de semana/año
// (o de fechaInicio, si la app no manda la semana).
router.post('/', async (req, res) => {
  try {
    const { precioPorKg, costoLitroLeche } = req.body;
    if (!precioPorKg || precioPorKg <= 0) return res.status(400).json({ ok: false, error: 'Precio inválido' });

    const { semana, anio } = Number(req.body.semana) && Number(req.body.anio)
      ? { semana: Number(req.body.semana), anio: Number(req.body.anio) }
      : semanaDeFecha(req.body.fechaInicio ? new Date(req.body.fechaInicio) : new Date());
    const { inicio, fin } = rangoSemana(semana, anio);

    // Solo queda "activo" el precio de la semana más reciente registrada
    const esMasReciente = !(await Precio.exists({ usuarioId: req.usuarioId, fechaInicio: { $gt: inicio } }));
    if (esMasReciente) await Precio.updateMany({ usuarioId: req.usuarioId, activo: true }, { activo: false });
    const precio = await Precio.create({
      usuarioId: req.usuarioId,
      semana, anio,
      fechaInicio: inicio,
      fechaFin: fin,
      precioPorKg,
      costoLitroLeche: costoLitroLeche || 0,
      activo: esMasReciente
    });
    res.status(201).json({ ok: true, data: precio });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
