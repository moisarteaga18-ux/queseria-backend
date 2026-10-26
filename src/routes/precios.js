const router = require('express').Router();
const { Precio, PrecioLeche } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { semanaDeFecha, semanaDeQuery } = require('../utils/semana');
const { precioQuesoDe, precioSemana, fijarPrecioLitro, fijarPrecioQueso } = require('../utils/precios');

// Cada semana (viernes a jueves) tiene: precio del queso por kg (`precios`) y precio del litro de
// leche (`precioleches`, el mismo que usan las liquidaciones). Esta ruta los muestra y edita juntos.

// GET /api/precios/actual?fecha=yyyy-MM-dd — precios de la semana que contiene esa fecha
router.get('/actual', async (req, res) => {
  try {
    const { semana, anio } = semanaDeQuery(req.query);
    const [queso, leche] = await Promise.all([
      precioQuesoDe(req.usuarioId, semana, anio),
      PrecioLeche.findOne({ usuarioId: req.usuarioId, semana, anio })
    ]);
    if (!queso && !leche) return res.status(404).json({ ok: false, error: 'No hay precios para esta semana' });
    res.json({ ok: true, data: precioSemana(semana, anio, queso, leche) });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/precios — una fila por semana (las más recientes primero)
router.get('/', async (req, res) => {
  try {
    const [quesos, leches] = await Promise.all([
      Precio.find({ usuarioId: req.usuarioId }).sort({ createdAt: -1 }).limit(60).lean(),
      PrecioLeche.find({ usuarioId: req.usuarioId }).sort({ anio: -1, semana: -1 }).limit(60).lean()
    ]);
    const semanas = new Map();
    const de = (semana, anio) => {
      const k = `${anio}-${semana}`;
      if (!semanas.has(k)) semanas.set(k, { semana, anio });
      return semanas.get(k);
    };
    // Si una semana tiene varios precios del queso (antes se creaba uno nuevo en cada cambio), vale el último
    for (const q of quesos) { const s = de(q.semana, q.anio); s.queso ??= q; }
    for (const l of leches) de(l.semana, l.anio).leche = l;
    const lista = [...semanas.values()]
      .map(s => precioSemana(s.semana, s.anio, s.queso, s.leche))
      .sort((a, b) => b.fechaInicio - a.fechaInicio)
      .slice(0, 30);
    res.json({ ok: true, data: lista });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/precios/semana  { semana, anio, precioPorKg, precioLitro, confirmar }
// Crea o corrige los precios de una semana (cualquiera de los dos puede omitirse).
// Cambiar el precio del litro de una semana con liquidaciones pagadas pide confirmación (409).
// POST /api/precios hace lo mismo (acepta también la forma anterior: fechaInicio y costoLitroLeche).
async function guardarSemana(req, res) {
  try {
    const { semana, anio } = Number(req.body.semana) && Number(req.body.anio)
      ? { semana: Number(req.body.semana), anio: Number(req.body.anio) }
      : semanaDeFecha(req.body.fechaInicio ? new Date(req.body.fechaInicio) : new Date());
    const leer = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const precioPorKg = leer(req.body.precioPorKg);
    // En la forma anterior costoLitroLeche: 0 significaba "sin definir"
    const precioLitro = leer(req.body.precioLitro ?? (Number(req.body.costoLitroLeche) > 0 ? req.body.costoLitroLeche : null));
    if (precioPorKg == null && precioLitro == null) throw errorHttp(400, 'Ingresa el precio del queso o el del litro de leche');
    if (precioPorKg != null && !(precioPorKg > 0)) throw errorHttp(400, 'Precio del queso inválido');
    if (precioLitro != null && !(precioLitro > 0)) throw errorHttp(400, 'Precio del litro inválido');

    // Primero el litro: si pide confirmación, no se guarda nada
    const leche = precioLitro != null
      ? await fijarPrecioLitro(req, semana, anio, precioLitro)
      : await PrecioLeche.findOne({ usuarioId: req.usuarioId, semana, anio });
    const queso = precioPorKg != null
      ? await fijarPrecioQueso(req.usuarioId, semana, anio, precioPorKg)
      : await precioQuesoDe(req.usuarioId, semana, anio);
    res.status(req.method === 'POST' ? 201 : 200).json({ ok: true, data: precioSemana(semana, anio, queso, leche) });
  } catch (e) {
    responderError(res, e);
  }
}
router.put('/semana', guardarSemana);
router.post('/', guardarSemana);

module.exports = router;
