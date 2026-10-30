// Precios de una semana (viernes a jueves):
// - precios de venta del queso por kg → colección `precios` (Precio): minorista (`precioPorKg`)
//   y mayorista (`precioMayoristaPorKg`)
// - precio del litro de leche        → colección `precioleches` (PrecioLeche), el único lugar del costo
//   del litro. Lo usan las liquidaciones, Ganancias y Reportes; Precios lo muestra y lo edita.

const { Precio, PrecioLeche } = require('../models');
const { errorHttp } = require('./inventario');
const { rangoSemana } = require('./semana');
const { pagadasAfectadas, exigirConfirmacion, recalcularPagadas } = require('./liquidacion');

const unidades = require('./unidades');

/**
 * Precio del queso de una semana: el registrado con ese número de semana o, para precios
 * guardados antes del corte viernes–jueves, el que se cruce con sus fechas.
 */
async function precioQuesoDe(usuarioId, semana, anio) {
  const { inicio, fin } = rangoSemana(semana, anio);
  return (await Precio.findOne({ usuarioId, semana, anio, fechaInicio: inicio }).sort({ createdAt: -1 }))
    || Precio.findOne({ usuarioId, fechaInicio: { $lte: fin }, fechaFin: { $gte: inicio } }).sort({ createdAt: -1 });
}

/** Una semana de Precios: queso y leche juntos (cualquiera de los dos puede faltar → null). */
function precioSemana(semana, anio, queso, leche) {
  const rango = rangoSemana(semana, anio);
  return {
    _id: queso?._id ?? null,
    semana, anio,
    // Los precios anteriores al corte viernes–jueves conservan sus fechas (lunes a domingo)
    fechaInicio: queso?.fechaInicio ?? rango.inicio,
    fechaFin: queso?.fechaFin ?? rango.fin,
    precioPorKg: queso?.precioPorKg ?? null,
    precioPorLibra: queso?.precioPorKg != null ? unidades.precioPorLibra(queso.precioPorKg) : null,
    precioMayoristaPorKg: queso?.precioMayoristaPorKg ?? null,
    precioMayoristaPorLibra: queso?.precioMayoristaPorKg != null ? unidades.precioPorLibra(queso.precioMayoristaPorKg) : null,
    precioLitro: leche?.precioLitro ?? null,
    activo: queso?.activo ?? false
  };
}

/**
 * Guarda el precio del litro de una semana. Si cambia y la semana tiene liquidaciones pagadas,
 * exige confirmación (409) y, confirmado, las recalcula (las pendientes se recalculan solas).
 */
async function fijarPrecioLitro(req, semana, anio, precioLitro) {
  if (!(precioLitro > 0)) throw errorHttp(400, 'Precio por litro inválido');
  const usuarioId = req.usuarioId;
  const anterior = await PrecioLeche.findOne({ usuarioId, semana, anio });
  if (anterior?.precioLitro === precioLitro) return anterior;

  const pagadas = await pagadasAfectadas(usuarioId, [{ semana, anio }]);
  exigirConfirmacion(req, pagadas);
  const precio = await PrecioLeche.findOneAndUpdate(
    { usuarioId, semana, anio },
    { precioLitro },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  await recalcularPagadas(pagadas);
  return precio;
}

/**
 * Guarda los precios del queso de una semana ({ precioPorKg, precioMayoristaPorKg }; los que vienen
 * en null no se cambian): corrige el que ya existe (el más reciente de esa semana) o crea uno nuevo.
 * Solo queda "activo" el de la semana más reciente.
 */
async function fijarPrecioQueso(usuarioId, semana, anio, precios) {
  const cambios = Object.fromEntries(Object.entries(precios).filter(([, v]) => v != null));
  if (!Object.keys(cambios).length || Object.values(cambios).some(v => !(v > 0))) throw errorHttp(400, 'Precio del queso inválido');
  const existente = await precioQuesoDe(usuarioId, semana, anio);
  if (existente && existente.semana === semana && existente.anio === anio) {
    existente.set(cambios);
    return existente.save();
  }
  const { inicio, fin } = rangoSemana(semana, anio);
  const esMasReciente = !(await Precio.exists({ usuarioId, fechaInicio: { $gt: inicio } }));
  if (esMasReciente) await Precio.updateMany({ usuarioId, activo: true }, { activo: false });
  return Precio.create({ usuarioId, semana, anio, fechaInicio: inicio, fechaFin: fin, ...cambios, activo: esMasReciente });
}

module.exports = { precioQuesoDe, precioSemana, fijarPrecioLitro, fijarPrecioQueso };
