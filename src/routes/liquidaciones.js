const router = require('express').Router();
const { Types } = require('mongoose');
const { Ganadero, Leche, PrecioLeche, Descuento, Liquidacion, LiquidacionAnulada, Contador } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { rangoSemana, semanaDeFecha, semanaDeQuery, semanaAnterior, textoRango } = require('../utils/semana');
const { textoOpcional } = require('../utils/texto');
const { redondear, precioDe, calcular, refrescar } = require('../utils/liquidacion');
const { fijarPrecioLitro } = require('../utils/precios');

const FORMAS_PAGO = ['efectivo', 'nequi', 'transferencia'];

function leerSemana(fuente) {
  const semana = Number(fuente.semana);
  const anio = Number(fuente.anio);
  if (!(semana >= 1 && semana <= 53) || !(anio > 2000)) throw errorHttp(400, 'Semana inválida');
  return { semana, anio };
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
  return l && { _id: l._id, numero: l.numero, estado: l.estado, total: l.total, totalPagado: l.totalPagado, fechaPago: l.fechaPago, formaPago: l.formaPago };
}

// GET /api/liquidaciones/semana?semana=&anio=&fecha=  (fecha = día local del teléfono)
// Por ganadero: litros, subtotal, descuentos, total y su liquidación (si existe).
// Si la semana ya cerró (pasó el jueves) y hay precio, genera las liquidaciones que falten
// (salvo las que el usuario anuló: esas se generan a mano).
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
      const anulados = new Set((await LiquidacionAnulada.distinct('ganaderoId', { usuarioId, semana, anio })).map(String));
      for (const g of ganaderos) {
        if (litrosDe[String(g._id)] > 0 && !anulados.has(String(g._id))) {
          await generar(usuarioId, g, semana, anio).catch(() => {});
        }
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
    const pagadoDe = (f) => f.liquidacion?.estado === 'pagado' ? (f.liquidacion.totalPagado ?? f.total) : 0;
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
        totalPagado: suma(pagadoDe),
        // Incluye la diferencia de una liquidación pagada que se corrigió después
        totalPendiente: suma(f => (f.total || 0) - pagadoDe(f)),
        sinLiquidar: filas.filter(f => !f.liquidacion && f.litros > 0).length,
        litrosSinGanadero: litrosDe['null'] || 0,
        ganaderos: filas
      }
    });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/liquidaciones/semanas?fecha=&n=8 — resumen de las últimas n semanas (la de [fecha] primero):
// litros, ganaderos, total a pagar, pagado y pendiente. No genera liquidaciones (eso lo hace /semana).
router.get('/semanas', async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const n = Math.min(Math.max(Number(req.query.n) || 8, 1), 26);

    const semanas = [];
    let s = semanaDeFecha(hoy);
    for (let i = 0; i < n; i++) {
      semanas.push({ ...s, ...rangoSemana(s.semana, s.anio) });
      s = semanaAnterior(s.semana, s.anio);
    }
    const desde = semanas[n - 1].inicio;
    const hasta = semanas[0].fin;

    const claves = semanas.map(w => ({ semana: w.semana, anio: w.anio }));
    const [leche, descuentos, liquidaciones, precios] = await Promise.all([
      Leche.find({ usuarioId, fecha: { $gte: desde, $lte: hasta } }).select('fecha litros ganaderoId').lean(),
      Descuento.find({ usuarioId, fecha: { $gte: desde, $lte: hasta } }).lean(),
      Liquidacion.find({ usuarioId, $or: claves }).lean(),
      PrecioLeche.find({ usuarioId, $or: claves }).lean()
    ]);
    const indice = (fecha) => semanas.findIndex(w => fecha >= w.inicio && fecha <= w.fin);

    const datos = semanas.map(w => ({
      precio: precios.find(p => p.semana === w.semana && p.anio === w.anio)?.precioLitro ?? null,
      litrosDe: {}, descuentosDe: {}, litrosSinGanadero: 0
    }));
    for (const r of leche) {
      const d = datos[indice(new Date(r.fecha))];
      if (!d) continue;
      if (!r.ganaderoId) { d.litrosSinGanadero += r.litros; continue; }
      d.litrosDe[r.ganaderoId] = (d.litrosDe[r.ganaderoId] || 0) + r.litros;
    }
    for (const x of descuentos) {
      const d = datos[indice(new Date(x.fecha))];
      if (d) (d.descuentosDe[x.ganaderoId] ||= []).push(x);
    }

    const resultado = semanas.map((w, i) => {
      const d = datos[i];
      const liqs = liquidaciones.filter(l => l.semana === w.semana && l.anio === w.anio);
      const ids = new Set([...Object.keys(d.litrosDe), ...liqs.map(l => String(l.ganaderoId))]);
      let totalAPagar = 0, totalPagado = 0, sinPrecio = 0, pagadas = 0, sinLiquidar = 0;
      for (const id of ids) {
        const liq = liqs.find(l => String(l.ganaderoId) === id);
        if (liq?.estado === 'pagado') { totalAPagar += liq.total; totalPagado += liq.totalPagado ?? liq.total; pagadas++; continue; }
        if (!liq) sinLiquidar++;
        // Igual que una liquidación pendiente: litros × precio − descuentos de la semana
        const precio = d.precio ?? liq?.precioLitro;
        if (precio == null) { sinPrecio++; continue; }
        const descuento = (d.descuentosDe[id] || []).reduce((suma, x) =>
          suma + (x.tipo === 'leche_rechazada' && x.litros ? x.litros * precio : (x.valor || 0)), 0);
        totalAPagar += (d.litrosDe[id] || 0) * precio - descuento;
      }
      return {
        semana: w.semana, anio: w.anio,
        fechaInicio: w.inicio, fechaFin: w.fin,
        texto: textoRango(w.inicio, w.fin),
        cerrada: hoy > w.fin,
        precioLitro: d.precio,
        totalLitros: redondear(Object.values(d.litrosDe).reduce((a, b) => a + b, 0)),
        ganaderos: ids.size,
        liquidaciones: liqs.length,
        pagadas,
        sinLiquidar,
        sinPrecio,
        totalAPagar: redondear(totalAPagar),
        totalPagado: redondear(totalPagado),
        totalPendiente: redondear(totalAPagar - totalPagado),
        litrosSinGanadero: redondear(d.litrosSinGanadero)
      };
    });
    res.json({ ok: true, data: resultado });
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

// PUT /api/liquidaciones/precio  { semana, anio, precioLitro, confirmar } — precio del litro de esa semana
// (el mismo que se edita en Precios). Si la semana tiene liquidaciones pagadas, pide confirmación (409).
router.put('/precio', async (req, res) => {
  try {
    const { semana, anio } = leerSemana(req.body);
    const precio = await fijarPrecioLitro(req, semana, anio, Number(req.body.precioLitro));
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
    liq.totalPagado = liq.total;
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
    liq.totalPagado = undefined;
    await liq.save();
    res.json({ ok: true, data: await refrescar(liq) });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/liquidaciones/:id — anula una liquidación pendiente (su número no se reutiliza
// y queda en liquidaciones_anuladas, así la semana cerrada no la vuelve a generar sola)
router.delete('/:id', async (req, res) => {
  try {
    const liq = await buscar(req);
    if (liq.estado === 'pagado') throw errorHttp(400, 'Una liquidación pagada no se puede eliminar; primero deshaz el pago');
    await LiquidacionAnulada.create({
      usuarioId: req.usuarioId, ganaderoId: liq.ganaderoId, nombreGanadero: liq.nombreGanadero,
      numero: liq.numero, semana: liq.semana, anio: liq.anio, total: liq.total
    });
    await liq.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
