const router = require('express').Router();
const { Types } = require('mongoose');
const { Ganadero, Leche, PrecioLeche, Pago } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { rangoSemana, semanaDeQuery } = require('../utils/semana');
const { textoOpcional } = require('../utils/texto');

const redondear = (n) => Math.round(n * 100) / 100;

/** Litros y número de entregas de cada ganadero en el rango ({ [ganaderoId|'null']: {litros, entregas} }). */
async function lecheDeLaSemana(usuarioId, inicio, fin) {
  const grupos = await Leche.aggregate([
    { $match: { usuarioId: new Types.ObjectId(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
    { $group: { _id: '$ganaderoId', litros: { $sum: '$litros' }, entregas: { $sum: 1 } } }
  ]);
  return Object.fromEntries(grupos.map(g => [String(g._id), { litros: g.litros, entregas: g.entregas }]));
}

// GET /api/pagos/semana?semana=43&anio=2026  (sin parámetros = semana actual)
// Por ganadero: litros recibidos, precio por litro, total a pagar y si ya se pagó.
router.get('/semana', async (req, res) => {
  try {
    const { semana, anio } = semanaDeQuery(req.query);
    const { inicio, fin } = rangoSemana(semana, anio);
    const usuarioId = req.usuarioId;

    const [leche, precio, pagos, ganaderos] = await Promise.all([
      lecheDeLaSemana(usuarioId, inicio, fin),
      PrecioLeche.findOne({ usuarioId, semana, anio }),
      Pago.find({ usuarioId, semana, anio }),
      Ganadero.find({ usuarioId }).collation({ locale: 'es' }).sort({ nombre: 1 })
    ]);
    const precioLitro = precio?.precioLitro ?? null;
    const pagoDe = Object.fromEntries(pagos.map(p => [String(p.ganaderoId), p]));

    // Solo los ganaderos que entregaron leche esa semana o que ya tienen el pago registrado
    const filas = ganaderos
      .filter(g => leche[String(g._id)] || pagoDe[String(g._id)])
      .map(g => {
        const id = String(g._id);
        const recibido = leche[id] || { litros: 0, entregas: 0 };
        const pago = pagoDe[id] || null;
        return {
          ganaderoId: g._id,
          nombre: g.nombre,
          telefono: g.telefono,
          entregas: recibido.entregas,
          // Si ya se pagó, se muestra lo que se pagó (litrosActuales avisa si luego cambió la leche)
          litros: pago ? pago.litros : recibido.litros,
          litrosActuales: recibido.litros,
          precioLitro: pago ? pago.precioLitro : precioLitro,
          total: pago ? pago.total : (precioLitro != null ? redondear(recibido.litros * precioLitro) : null),
          pagado: !!pago,
          pago
        };
      });

    const sinGanadero = leche['null'] || leche['undefined'] || { litros: 0, entregas: 0 };

    res.json({
      ok: true,
      data: {
        semana, anio,
        fechaInicio: inicio,
        fechaFin: fin,
        precioLitro,
        totalLitros: redondear(filas.reduce((s, f) => s + f.litros, 0)),
        totalAPagar: redondear(filas.reduce((s, f) => s + (f.total || 0), 0)),
        totalPagado: redondear(filas.filter(f => f.pagado).reduce((s, f) => s + f.total, 0)),
        litrosSinGanadero: sinGanadero.litros,
        ganaderos: filas
      }
    });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/pagos/precio  { semana, anio, precioLitro } — precio del litro de esa semana
router.put('/precio', async (req, res) => {
  try {
    const semana = Number(req.body.semana);
    const anio = Number(req.body.anio);
    const precioLitro = Number(req.body.precioLitro);
    if (!(semana >= 1 && semana <= 53) || !(anio > 2000)) throw errorHttp(400, 'Semana inválida');
    if (!(precioLitro > 0)) throw errorHttp(400, 'Precio por litro inválido');

    const precio = await PrecioLeche.findOneAndUpdate(
      { usuarioId: req.usuarioId, semana, anio },
      { precioLitro },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, data: precio });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/pagos/precios — precios del litro definidos (últimas semanas)
router.get('/precios', async (req, res) => {
  try {
    const precios = await PrecioLeche.find({ usuarioId: req.usuarioId }).sort({ anio: -1, semana: -1 }).limit(52);
    res.json({ ok: true, data: precios });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/pagos  { ganaderoId, semana, anio, notas } — marca la semana del ganadero como pagada
router.post('/', async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    const semana = Number(req.body.semana);
    const anio = Number(req.body.anio);
    if (!(semana >= 1 && semana <= 53) || !(anio > 2000)) throw errorHttp(400, 'Semana inválida');

    const ganadero = await Ganadero.findOne({ _id: req.body.ganaderoId, usuarioId });
    if (!ganadero) throw errorHttp(404, 'Ganadero no encontrado');
    if (await Pago.exists({ usuarioId, ganaderoId: ganadero._id, semana, anio })) {
      throw errorHttp(400, `La semana ${semana} de ${ganadero.nombre} ya está pagada`);
    }
    const precio = await PrecioLeche.findOne({ usuarioId, semana, anio });
    if (!precio) throw errorHttp(400, 'Primero define el precio del litro de esta semana');

    const { inicio, fin } = rangoSemana(semana, anio);
    const litros = (await lecheDeLaSemana(usuarioId, inicio, fin))[String(ganadero._id)]?.litros || 0;
    if (litros <= 0) throw errorHttp(400, `${ganadero.nombre} no entregó leche esa semana`);

    const pago = await Pago.create({
      usuarioId,
      ganaderoId: ganadero._id,
      nombreGanadero: ganadero.nombre,
      semana, anio,
      fechaInicio: inicio,
      fechaFin: fin,
      litros,
      precioLitro: precio.precioLitro,
      total: redondear(litros * precio.precioLitro),
      fechaPago: req.body.fechaPago ? new Date(req.body.fechaPago) : new Date(),
      notas: textoOpcional(req.body.notas)
    });
    res.status(201).json({ ok: true, data: pago });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/pagos?ganaderoId=&limit=100 — historial de pagos hechos
router.get('/', async (req, res) => {
  try {
    const filtro = { usuarioId: req.usuarioId };
    if (req.query.ganaderoId) filtro.ganaderoId = req.query.ganaderoId;
    const pagos = await Pago.find(filtro)
      .sort({ anio: -1, semana: -1, nombreGanadero: 1 })
      .limit(Number(req.query.limit || 100));
    res.json({ ok: true, data: pagos });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/pagos/:id — deshace un pago (la semana vuelve a quedar pendiente)
router.delete('/:id', async (req, res) => {
  try {
    await Pago.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
