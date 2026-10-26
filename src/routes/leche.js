const router = require('express').Router();
const { Types } = require('mongoose');
const { Leche, Ganadero, Produccion } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { DIA_MS, iso } = require('../utils/semana');
const { textoOpcional } = require('../utils/texto');
const { pagadasAfectadas, exigirConfirmacion, recalcularPagadas } = require('../utils/liquidacion');

/** "yyyy-MM-dd" → medianoche UTC (así se guardan las fechas que manda la app). */
function diaUtc(texto) {
  const d = new Date(texto);
  if (isNaN(d)) throw errorHttp(400, 'Fecha inválida');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Agrega `nombreGanadero` (de la ficha del ganadero, también si está archivado). */
async function conNombre(usuarioId, registros) {
  const ids = [...new Set(registros.map(r => String(r.ganaderoId)).filter(id => id !== 'undefined' && id !== 'null'))];
  const ganaderos = await Ganadero.find({ usuarioId, _id: { $in: ids } }).select('nombre').lean();
  const nombreDe = Object.fromEntries(ganaderos.map(g => [String(g._id), g.nombre]));
  return registros.map(r => ({ ...(r.toObject ? r.toObject() : r), nombreGanadero: nombreDe[String(r.ganaderoId)] ?? null }));
}

async function ganaderoDe(usuarioId, ganaderoId) {
  if (!ganaderoId) throw errorHttp(400, 'Elige de qué ganadero viene la leche');
  const ganadero = await Ganadero.findOne({ _id: ganaderoId, usuarioId });
  if (!ganadero) throw errorHttp(404, 'Ganadero no encontrado');
  return ganadero;
}

// GET /api/leche?limit=30&fecha=&desde=&hasta=&ganaderoId=
router.get('/', async (req, res) => {
  try {
    const { limit = 30, fecha, desde, hasta, ganaderoId } = req.query;
    const filter = { usuarioId: req.usuarioId };
    if (fecha) {
      const d = diaUtc(fecha);
      filter.fecha = { $gte: d, $lt: new Date(d.getTime() + DIA_MS) };
    } else if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = diaUtc(desde);
      if (hasta) filter.fecha.$lt = new Date(diaUtc(hasta).getTime() + DIA_MS);
    }
    if (ganaderoId) filter.ganaderoId = ganaderoId;
    const registros = await Leche.find(filter).sort({ fecha: -1, createdAt: -1 }).limit(Number(limit)).lean();
    res.json({ ok: true, data: await conNombre(req.usuarioId, registros) });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/leche/dias?desde=yyyy-MM-dd&hasta=yyyy-MM-dd — por cada día: litros recibidos (total y por
// ganadero) y litros ya usados en producción. Lo usan el calendario por semanas y Producción.
router.get('/dias', async (req, res) => {
  try {
    const desde = diaUtc(req.query.desde || new Date());
    const hasta = diaUtc(req.query.hasta || desde);
    const n = Math.round((hasta - desde) / DIA_MS) + 1;
    if (!(n >= 1 && n <= 62)) throw errorHttp(400, 'Rango de fechas inválido');
    const rango = { $gte: desde, $lt: new Date(hasta.getTime() + DIA_MS) };
    const usuarioId = new Types.ObjectId(req.usuarioId);
    const [leche, produccion] = await Promise.all([
      Leche.find({ usuarioId, fecha: rango }).select('fecha litros ganaderoId').lean(),
      Produccion.find({ usuarioId, fecha: rango }).select('fecha litrosUsados').lean()
    ]);
    const dias = Array.from({ length: n }, (_, i) => ({
      fecha: iso(new Date(desde.getTime() + i * DIA_MS)), litros: 0, entregas: 0, litrosUsados: 0, porGanadero: {}
    }));
    const diaDe = (f) => dias[Math.floor((diaUtc(f) - desde) / DIA_MS)];
    for (const r of leche) {
      const d = diaDe(r.fecha);
      d.litros += r.litros;
      d.entregas += 1;
      d.porGanadero[r.ganaderoId] = (d.porGanadero[r.ganaderoId] || 0) + r.litros;
    }
    for (const p of produccion) diaDe(p.fecha).litrosUsados += p.litrosUsados || 0;
    res.json({
      ok: true,
      data: dias.map(d => ({
        ...d,
        litros: Math.round(d.litros * 100) / 100,
        litrosUsados: Math.round(d.litrosUsados * 100) / 100,
        porGanadero: Object.entries(d.porGanadero).map(([ganaderoId, litros]) => ({ ganaderoId, litros }))
      }))
    });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/leche  { fecha, litros, ganaderoId, observaciones, confirmar }
// Si el ganadero ya tiene pagada la liquidación de esa semana, pide confirmación (409).
router.post('/', async (req, res) => {
  try {
    const { fecha, litros, ganaderoId, observaciones } = req.body;
    if (!(Number(litros) > 0)) throw errorHttp(400, 'Litros inválidos');
    const ganadero = await ganaderoDe(req.usuarioId, ganaderoId);
    const dia = fecha ? new Date(fecha) : new Date();

    const pagadas = await pagadasAfectadas(req.usuarioId, [{ ganaderoId: ganadero._id, fecha: dia }]);
    exigirConfirmacion(req, pagadas);
    const registro = await Leche.create({
      usuarioId: req.usuarioId,
      fecha: dia,
      litros: Number(litros),
      ganaderoId: ganadero._id,
      observaciones: textoOpcional(observaciones)
    });
    await recalcularPagadas(pagadas);
    res.status(201).json({ ok: true, data: { ...registro.toObject(), nombreGanadero: ganadero.nombre } });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/leche/:id  { fecha, litros, ganaderoId, observaciones, confirmar } — corregir un registro.
// Las liquidaciones pendientes se recalculan solas; si el registro está (o pasa a estar) en una semana
// ya pagada de ese ganadero, pide confirmación (409) y, confirmado, recalcula esa liquidación.
router.put('/:id', async (req, res) => {
  try {
    const registro = await Leche.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!registro) throw errorHttp(404, 'Registro no encontrado');
    const antes = { ganaderoId: registro.ganaderoId, fecha: registro.fecha };
    const { fecha, litros, ganaderoId, observaciones } = req.body;
    if (litros !== undefined) {
      if (!(Number(litros) > 0)) throw errorHttp(400, 'Litros inválidos');
      registro.litros = Number(litros);
    }
    if (fecha) registro.fecha = new Date(fecha);
    if (ganaderoId) registro.ganaderoId = (await ganaderoDe(req.usuarioId, ganaderoId))._id;
    if (observaciones !== undefined) registro.observaciones = textoOpcional(observaciones);
    if (!registro.isModified()) return res.json({ ok: true, data: (await conNombre(req.usuarioId, [registro]))[0] });

    // Solo litros, fecha y ganadero cambian lo que se paga (la nota no)
    const cambiaPago = ['litros', 'fecha', 'ganaderoId'].some(c => registro.isModified(c));
    const pagadas = cambiaPago ? await pagadasAfectadas(req.usuarioId, [
      antes.ganaderoId && antes,
      { ganaderoId: registro.ganaderoId, fecha: registro.fecha }
    ]) : [];
    exigirConfirmacion(req, pagadas);
    await registro.save();
    await recalcularPagadas(pagadas);
    res.json({ ok: true, data: (await conNombre(req.usuarioId, [registro]))[0] });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/leche/:id?confirmar=true
router.delete('/:id', async (req, res) => {
  try {
    const registro = await Leche.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!registro) return res.json({ ok: true });
    const pagadas = registro.ganaderoId
      ? await pagadasAfectadas(req.usuarioId, [{ ganaderoId: registro.ganaderoId, fecha: registro.fecha }])
      : [];
    exigirConfirmacion(req, pagadas);
    await registro.deleteOne();
    await recalcularPagadas(pagadas);
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
