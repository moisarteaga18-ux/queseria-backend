const router = require('express').Router();
const { Types } = require('mongoose');
const { Ganadero, Leche, PrecioLeche, Descuento, Liquidacion, Contador } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { DIA_MS, rangoSemana, semanaDeQuery, textoRango, iso } = require('../utils/semana');
const { textoOpcional } = require('../utils/texto');

const redondear = (n) => Math.round(n * 100) / 100;
const FORMAS_PAGO = ['efectivo', 'nequi', 'transferencia'];

function leerSemana(fuente) {
  const semana = Number(fuente.semana);
  const anio = Number(fuente.anio);
  if (!(semana >= 1 && semana <= 53) || !(anio > 2000)) throw errorHttp(400, 'Semana inválida');
  return { semana, anio };
}

async function precioDe(usuarioId, semana, anio) {
  return (await PrecioLeche.findOne({ usuarioId, semana, anio }))?.precioLitro ?? null;
}

/**
 * Calcula (sin guardar) la liquidación de un ganadero en una semana viernes–jueves:
 * litros por día, subtotal, descuentos registrados en la semana y total a pagar.
 */
async function calcular(usuarioId, ganadero, semana, anio, precioLitro) {
  const { inicio, fin } = rangoSemana(semana, anio);
  const [registros, descuentos] = await Promise.all([
    Leche.find({ usuarioId, ganaderoId: ganadero._id, fecha: { $gte: inicio, $lte: fin } }).lean(),
    Descuento.find({ usuarioId, ganaderoId: ganadero._id, fecha: { $gte: inicio, $lte: fin } }).sort({ fecha: 1 }).lean()
  ]);

  const dias = Array.from({ length: 7 }, (_, i) => ({
    fecha: iso(new Date(inicio.getTime() + i * DIA_MS)), litros: 0, entregas: 0
  }));
  for (const r of registros) {
    const dia = dias[Math.floor((new Date(r.fecha) - inicio) / DIA_MS)];
    if (dia) { dia.litros += r.litros; dia.entregas += 1; }
  }
  dias.forEach(d => { d.litros = redondear(d.litros); });

  const precio = precioLitro ?? 0;
  const litros = redondear(registros.reduce((s, r) => s + r.litros, 0));
  const subtotal = redondear(litros * precio);
  const lineas = descuentos.map(d => ({
    descuentoId: d._id,
    tipo: d.tipo,
    fecha: d.fecha,
    descripcion: d.descripcion,
    litros: d.litros,
    // La leche rechazada se descuenta al precio del litro de la semana
    valor: redondear(d.tipo === 'leche_rechazada' && d.litros ? d.litros * precio : (d.valor || 0))
  }));
  const totalDescuentos = redondear(lineas.reduce((s, l) => s + l.valor, 0));

  return {
    ganaderoId: ganadero._id,
    nombreGanadero: ganadero.nombre,
    telefonoGanadero: ganadero.telefono,
    semana, anio,
    fechaInicio: inicio,
    fechaFin: fin,
    dias, litros,
    precioLitro: precio,
    subtotal,
    descuentos: lineas,
    totalDescuentos,
    total: redondear(subtotal - totalDescuentos)
  };
}

/** Recalcula una liquidación pendiente con los datos actuales (las pagadas no se tocan). */
async function refrescar(liq) {
  if (liq.estado !== 'pendiente') return liq;
  const ganadero = await Ganadero.findById(liq.ganaderoId);
  if (!ganadero) return liq;
  const precio = (await precioDe(liq.usuarioId, liq.semana, liq.anio)) ?? liq.precioLitro;
  liq.set(await calcular(liq.usuarioId, ganadero, liq.semana, liq.anio, precio));
  if (liq.isModified()) await liq.save();
  return liq;
}

async function siguienteNumero(usuarioId) {
  const c = await Contador.findOneAndUpdate(
    { usuarioId, nombre: 'liquidacion' }, { $inc: { valor: 1 } }, { new: true, upsert: true }
  );
  return c.valor;
}

/** Crea la liquidación de la semana (o actualiza la pendiente que ya existe). */
async function generar(usuarioId, ganadero, semana, anio) {
  const existente = await Liquidacion.findOne({ usuarioId, ganaderoId: ganadero._id, semana, anio });
  if (existente) return refrescar(existente);

  const precio = await precioDe(usuarioId, semana, anio);
  if (precio == null) throw errorHttp(400, 'Primero define el precio del litro de esta semana');
  const datos = await calcular(usuarioId, ganadero, semana, anio, precio);
  if (datos.litros <= 0) throw errorHttp(400, `${ganadero.nombre} no entregó leche esta semana`);
  return Liquidacion.create({ ...datos, usuarioId, numero: await siguienteNumero(usuarioId), estado: 'pendiente' });
}

function resumenLiquidacion(l) {
  return l && { _id: l._id, numero: l.numero, estado: l.estado, total: l.total, fechaPago: l.fechaPago, formaPago: l.formaPago };
}

// GET /api/liquidaciones/semana?semana=&anio=&fecha=  (fecha = día local del teléfono)
// Por ganadero: litros, subtotal, descuentos, total y su liquidación (si existe).
// Si la semana ya cerró (pasó el jueves) y hay precio, genera las liquidaciones que falten.
router.get('/semana', async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    const { semana, anio } = semanaDeQuery(req.query);
    const { inicio, fin } = rangoSemana(semana, anio);
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const cerrada = hoy > fin;

    const [precio, ganaderos, lecheAgrupada, conDescuentos] = await Promise.all([
      precioDe(usuarioId, semana, anio),
      Ganadero.find({ usuarioId }).collation({ locale: 'es' }).sort({ nombre: 1 }),
      Leche.aggregate([
        { $match: { usuarioId: new Types.ObjectId(usuarioId), fecha: { $gte: inicio, $lte: fin } } },
        { $group: { _id: '$ganaderoId', litros: { $sum: '$litros' } } }
      ]),
      Descuento.distinct('ganaderoId', { usuarioId, fecha: { $gte: inicio, $lte: fin } })
    ]);
    const litrosDe = Object.fromEntries(lecheAgrupada.map(g => [String(g._id), g.litros]));

    if (cerrada && precio != null) {
      for (const g of ganaderos) {
        if (litrosDe[String(g._id)] > 0) await generar(usuarioId, g, semana, anio).catch(() => {});
      }
    }

    const liquidaciones = await Liquidacion.find({ usuarioId, semana, anio });
    for (const l of liquidaciones) await refrescar(l);
    const liqDe = Object.fromEntries(liquidaciones.map(l => [String(l.ganaderoId), l]));
    const descuentoDe = new Set(conDescuentos.map(String));

    const filas = [];
    for (const g of ganaderos) {
      const id = String(g._id);
      const liq = liqDe[id];
      if (!liq && !litrosDe[id] && !descuentoDe.has(id)) continue;
      const datos = liq || await calcular(usuarioId, g, semana, anio, precio);
      filas.push({
        ganaderoId: g._id,
        nombre: g.nombre,
        telefono: g.telefono,
        litros: datos.litros,
        subtotal: precio == null && !liq ? null : datos.subtotal,
        totalDescuentos: datos.totalDescuentos,
        total: precio == null && !liq ? null : datos.total,
        liquidacion: resumenLiquidacion(liq)
      });
    }

    const suma = (f) => redondear(filas.reduce((s, x) => s + (f(x) || 0), 0));
    res.json({
      ok: true,
      data: {
        semana, anio,
        fechaInicio: inicio,
        fechaFin: fin,
        texto: textoRango(inicio, fin),
        cerrada,
        precioLitro: precio,
        totalLitros: suma(f => f.litros),
        totalAPagar: suma(f => f.total),
        totalPagado: suma(f => f.liquidacion?.estado === 'pagado' ? f.total : 0),
        totalPendiente: suma(f => f.liquidacion?.estado === 'pagado' ? 0 : f.total),
        sinLiquidar: filas.filter(f => !f.liquidacion && f.litros > 0).length,
        litrosSinGanadero: litrosDe['null'] || 0,
        ganaderos: filas
      }
    });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/liquidaciones/previa?ganaderoId=&semana=&anio= — la liquidación (guardada o calculada)
router.get('/previa', async (req, res) => {
  try {
    const { semana, anio } = leerSemana(req.query);
    const ganadero = await Ganadero.findOne({ _id: req.query.ganaderoId, usuarioId: req.usuarioId });
    if (!ganadero) throw errorHttp(404, 'Ganadero no encontrado');
    const existente = await Liquidacion.findOne({ usuarioId: req.usuarioId, ganaderoId: ganadero._id, semana, anio });
    if (existente) return res.json({ ok: true, data: await refrescar(existente) });
    const precio = await precioDe(req.usuarioId, semana, anio);
    const datos = await calcular(req.usuarioId, ganadero, semana, anio, precio);
    res.json({ ok: true, data: { ...datos, precioDefinido: precio != null, estado: 'sin_generar' } });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/liquidaciones/resumen — liquidaciones pendientes de pago (para Inicio)
router.get('/resumen', async (req, res) => {
  try {
    const pendientes = await Liquidacion.find({ usuarioId: req.usuarioId, estado: 'pendiente' });
    for (const l of pendientes) await refrescar(l);
    res.json({
      ok: true,
      data: {
        pendientes: pendientes.length,
        totalPendiente: redondear(pendientes.reduce((s, l) => s + l.total, 0)),
        ganaderos: [...new Set(pendientes.map(l => l.nombreGanadero))]
      }
    });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/liquidaciones/precio  { semana, anio, precioLitro } — precio del litro de esa semana
router.put('/precio', async (req, res) => {
  try {
    const { semana, anio } = leerSemana(req.body);
    const precioLitro = Number(req.body.precioLitro);
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

// GET /api/liquidaciones/precios — precios del litro definidos (últimas semanas)
router.get('/precios', async (req, res) => {
  try {
    const precios = await PrecioLeche.find({ usuarioId: req.usuarioId }).sort({ anio: -1, semana: -1 }).limit(52);
    res.json({ ok: true, data: precios });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/liquidaciones  { ganaderoId, semana, anio } — genera (o actualiza) la liquidación
router.post('/', async (req, res) => {
  try {
    const { semana, anio } = leerSemana(req.body);
    const ganadero = await Ganadero.findOne({ _id: req.body.ganaderoId, usuarioId: req.usuarioId });
    if (!ganadero) throw errorHttp(404, 'Ganadero no encontrado');
    const liq = await generar(req.usuarioId, ganadero, semana, anio);
    res.status(201).json({ ok: true, data: liq });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/liquidaciones/generar-semana  { semana, anio } — genera las de todos los ganaderos con leche
router.post('/generar-semana', async (req, res) => {
  try {
    const { semana, anio } = leerSemana(req.body);
    const { inicio, fin } = rangoSemana(semana, anio);
    if ((await precioDe(req.usuarioId, semana, anio)) == null) {
      throw errorHttp(400, 'Primero define el precio del litro de esta semana');
    }
    const ids = await Leche.distinct('ganaderoId', { usuarioId: req.usuarioId, fecha: { $gte: inicio, $lte: fin } });
    const ganaderos = await Ganadero.find({ usuarioId: req.usuarioId, _id: { $in: ids.filter(Boolean) } });
    const generadas = [];
    for (const g of ganaderos) generadas.push(await generar(req.usuarioId, g, semana, anio));
    res.status(201).json({ ok: true, data: generadas });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/liquidaciones?ganaderoId=&estado=&limit=100 — historial
router.get('/', async (req, res) => {
  try {
    const filtro = { usuarioId: req.usuarioId };
    if (req.query.ganaderoId) filtro.ganaderoId = req.query.ganaderoId;
    if (req.query.estado) filtro.estado = req.query.estado;
    const lista = await Liquidacion.find(filtro)
      .sort({ fechaInicio: -1, numero: -1 })
      .limit(Number(req.query.limit || 100));
    for (const l of lista) await refrescar(l);
    res.json({ ok: true, data: lista });
  } catch (e) {
    responderError(res, e);
  }
});

async function buscar(req) {
  const liq = await Liquidacion.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
  if (!liq) throw errorHttp(404, 'Liquidación no encontrada');
  return liq;
}

// GET /api/liquidaciones/:id
router.get('/:id', async (req, res) => {
  try {
    res.json({ ok: true, data: await refrescar(await buscar(req)) });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/liquidaciones/:id/pagar  { fechaPago, formaPago: efectivo|nequi|transferencia, notas }
router.put('/:id/pagar', async (req, res) => {
  try {
    const liq = await buscar(req);
    if (liq.estado === 'pagado') throw errorHttp(400, `La liquidación N° ${liq.numero} ya está pagada`);
    if (!FORMAS_PAGO.includes(req.body.formaPago)) throw errorHttp(400, 'Elige la forma de pago');
    await refrescar(liq); // se congela con los datos al momento del pago
    liq.estado = 'pagado';
    liq.formaPago = req.body.formaPago;
    liq.fechaPago = req.body.fechaPago ? new Date(req.body.fechaPago) : new Date();
    liq.notas = textoOpcional(req.body.notas);
    await liq.save();
    res.json({ ok: true, data: liq });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/liquidaciones/:id/pendiente — deshace el pago (vuelve a pendiente y se recalcula)
router.put('/:id/pendiente', async (req, res) => {
  try {
    const liq = await buscar(req);
    liq.estado = 'pendiente';
    liq.fechaPago = undefined;
    liq.formaPago = undefined;
    await liq.save();
    res.json({ ok: true, data: await refrescar(liq) });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/liquidaciones/:id — anula una liquidación pendiente (su número no se reutiliza)
router.delete('/:id', async (req, res) => {
  try {
    const liq = await buscar(req);
    if (liq.estado === 'pagado') throw errorHttp(400, 'Una liquidación pagada no se puede eliminar; primero deshaz el pago');
    await liq.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
