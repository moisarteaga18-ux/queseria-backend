const router = require('express').Router();
const { CierreSemana } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { rangoSemana } = require('../utils/semana');
const { calcularMerma, cuentaDeUsuario } = require('../utils/merma');
const { vacio } = require('../utils/validar');

const r2 = (n) => Math.round(n * 100) / 100;

// GET /api/merma?fecha=yyyy-MM-dd — cuenta de cada semana (ventas por lote, lo que sobró, merma registrada por
// el usuario o pendiente), promedio de las semanas con merma, semana en curso y queso por vender. No escribe nada.
router.get('/', async (req, res) => {
  try {
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    res.json({ ok: true, data: await calcularMerma(req.usuarioId, hoy) });
  } catch (e) {
    responderError(res, e);
  }
});

/** Semana de la URL, ya cerrada (pasó su jueves) según `fecha` del cuerpo (hoy de la app). */
function semanaCerrada(req, que) {
  const semana = Number(req.params.semana);
  const anio = Number(req.params.anio);
  if (!(semana >= 1 && semana <= 53) || !(anio > 2000)) throw errorHttp(400, 'Semana inválida');
  const hoy = req.body?.fecha ? new Date(req.body.fecha) : new Date();
  if (Number.isNaN(hoy.getTime())) throw errorHttp(400, 'Fecha inválida');
  const { inicio, fin } = rangoSemana(semana, anio);
  if (hoy <= fin) throw errorHttp(400, `Esa semana todavía no ha cerrado: ${que} desde el viernes`);
  return { semana, anio, hoy, inicio, fin };
}

/** Número ≥ 0 del cuerpo (kg). */
function kgDelCuerpo(valor, faltante, nombre) {
  if (vacio(valor)) throw errorHttp(400, faltante);
  const kg = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : NaN;
  if (!Number.isFinite(kg)) throw errorHttp(400, `${nombre} deben ser un número`);
  if (kg < 0) throw errorHttp(400, `${nombre} no pueden ser negativos`);
  return r2(kg);
}

/** Cuenta (solo lectura) de una semana para validar lo que sobró. */
async function cuentaDeSemana(usuarioId, semana, anio, hoy) {
  return (await cuentaDeUsuario(usuarioId, hoy)).find(s => s.semana === semana && s.anio === anio) || null;
}

// PUT /api/merma/:anio/:semana  { kgFinal, fecha } — "Pasar queso a la semana siguiente": kg del queso de esa
// semana que el usuario pasa a la siguiente (0 = no pasa nada / deshacer). Es opcional: solo cuando el
// usuario quiera. Solo para semanas que ya cerraron (pasó su jueves). Si ya registró la merma, lo pasado
// más la merma no puede ser más de lo que sobró.
router.put('/:anio/:semana', async (req, res) => {
  try {
    const { semana, anio, hoy, inicio, fin } = semanaCerrada(req, 'se puede pasar queso');
    const kgFinal = kgDelCuerpo(req.body.kgFinal, 'Escribe los kg que pasas a la semana siguiente (0 para no pasar nada)', 'Los kg que pasas');

    const cierre = await CierreSemana.findOne({ usuarioId: req.usuarioId, semana, anio }).lean();
    if (cierre?.mermaRegistradaKg != null) {
      const c = await cuentaDeSemana(req.usuarioId, semana, anio, hoy);
      const sobrante = c?.sobranteKg ?? 0;
      const merma = Number(cierre.mermaRegistradaKg);
      if (kgFinal + merma > sobrante + 0.01) {
        throw errorHttp(400, `De esa semana sobraron ${r2(sobrante)} kg y ya registraste ${r2(merma)} kg de merma: ` +
          `puedes pasar hasta ${r2(Math.max(0, sobrante - merma))} kg. Si quieres pasar más, corrige primero la merma.`);
      }
    }

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

// PUT /api/merma/:anio/:semana/merma  { kg, fecha } — "Registrar merma" (o corregirla): kg de queso que se
// perdió esa semana. Solo semanas cerradas. merma + lo pasado a la semana siguiente ≤ lo que sobró.
// Responde la merma anterior (`anterior`, null si no había) para poder deshacer, y la cuenta de merma.
router.put('/:anio/:semana/merma', async (req, res) => {
  try {
    const { semana, anio, hoy, inicio, fin } = semanaCerrada(req, 'se puede registrar la merma');
    const kg = kgDelCuerpo(req.body.kg, 'Escribe los kg de merma (0 si no hubo)', 'Los kg de merma');

    const c = await cuentaDeSemana(req.usuarioId, semana, anio, hoy);
    if (!c || c.stockInicialKg + c.kgProducidos <= 0) {
      throw errorHttp(400, 'Esa semana no tiene queso producido ni pasado: no hay merma que registrar');
    }
    const sobrante = c.sobranteKg ?? 0;
    const pasado = c.kgPasados || 0;
    if (kg + pasado > sobrante + 0.01) {
      const maximo = r2(Math.max(0, sobrante - pasado));
      throw errorHttp(400, pasado > 0
        ? `De esa semana sobraron ${r2(sobrante)} kg y pasaste ${r2(pasado)} kg a la siguiente: la merma puede ser hasta ${maximo} kg`
        : `De esa semana sobraron ${r2(sobrante)} kg: la merma puede ser hasta ${maximo} kg`);
    }

    const antes = await CierreSemana.findOne({ usuarioId: req.usuarioId, semana, anio }).lean();
    await CierreSemana.findOneAndUpdate(
      { usuarioId: req.usuarioId, semana, anio },
      { mermaRegistradaKg: kg, mermaRegistradaEn: new Date(), $setOnInsert: { fechaInicio: inicio, fechaFin: fin } },
      { upsert: true, new: true }
    );
    const anterior = antes?.mermaRegistradaKg != null ? Number(antes.mermaRegistradaKg) : null;
    res.json({ ok: true, data: { anterior, ...(await calcularMerma(req.usuarioId, hoy)) } });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/merma/:anio/:semana/merma — quita la merma registrada (la semana vuelve a "pendiente por
// registrar"). Responde `anterior` (los kg que tenía) para que la app pueda deshacer volviendo a registrarla.
router.delete('/:anio/:semana/merma', async (req, res) => {
  try {
    const semana = Number(req.params.semana);
    const anio = Number(req.params.anio);
    if (!(semana >= 1 && semana <= 53) || !(anio > 2000)) throw errorHttp(400, 'Semana inválida');
    const antes = await CierreSemana.findOne({ usuarioId: req.usuarioId, semana, anio }).lean();
    if (antes?.mermaRegistradaKg == null) throw errorHttp(404, 'Esa semana no tiene merma registrada');
    await CierreSemana.updateOne({ _id: antes._id }, { $unset: { mermaRegistradaKg: 1, mermaRegistradaEn: 1 } });
    const hoy = req.query.fecha ? new Date(req.query.fecha) : new Date();
    res.json({ ok: true, data: { anterior: Number(antes.mermaRegistradaKg), ...(await calcularMerma(req.usuarioId, hoy)) } });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
