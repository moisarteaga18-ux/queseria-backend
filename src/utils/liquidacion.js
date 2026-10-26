// Cálculo de la liquidación semanal (viernes a jueves) de un ganadero, compartido por las rutas
// de liquidaciones, leche y precios (al corregir un registro hay que recalcular lo que dependa de él).

const { Ganadero, Leche, PrecioLeche, Descuento, Liquidacion } = require('../models');
const { errorHttp } = require('./inventario');
const { DIA_MS, rangoSemana, semanaDeFecha, textoRango, iso } = require('./semana');

const redondear = (n) => Math.round(n * 100) / 100;

/** Precio del litro de leche de la semana (el único lugar donde se guarda), o null si no se definió. */
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

/**
 * Recalcula una liquidación con los datos actuales. Las pagadas no se tocan, salvo con
 * [incluirPagadas] (el usuario confirmó una corrección en esa semana): siguen pagadas y
 * conservan en `totalPagado` lo que se pagó, para mostrar la diferencia.
 */
async function refrescar(liq, { incluirPagadas = false } = {}) {
  if (liq.estado !== 'pendiente' && !incluirPagadas) return liq;
  const ganadero = await Ganadero.findById(liq.ganaderoId);
  if (!ganadero) return liq;
  if (liq.estado === 'pagado' && liq.totalPagado == null) liq.totalPagado = liq.total;
  const precio = (await precioDe(liq.usuarioId, liq.semana, liq.anio)) ?? liq.precioLitro;
  liq.set(await calcular(liq.usuarioId, ganadero, liq.semana, liq.anio, precio));
  if (liq.isModified()) await liq.save();
  return liq;
}

/** ¿El cliente confirmó que quiere cambiar una semana ya pagada? (body.confirmar o ?confirmar=true) */
function confirmado(req) {
  return req.body?.confirmar === true || req.query?.confirmar === 'true';
}

/**
 * Liquidaciones pagadas afectadas por un cambio. [cambios] = [{ ganaderoId, fecha }] (registros de
 * leche: el de antes y el de después) o [{ semana, anio }] (precio del litro: todos los ganaderos).
 */
async function pagadasAfectadas(usuarioId, cambios) {
  const condiciones = [];
  for (const c of cambios) {
    if (!c) continue;
    const { semana, anio } = c.fecha ? semanaDeFecha(new Date(c.fecha)) : c;
    condiciones.push(c.ganaderoId ? { ganaderoId: c.ganaderoId, semana, anio } : { semana, anio });
  }
  if (!condiciones.length) return [];
  return Liquidacion.find({ usuarioId, estado: 'pagado', $or: condiciones });
}

/**
 * Si el cambio toca liquidaciones ya pagadas y el usuario no lo confirmó, responde 409 con
 * `requiereConfirmacion` para que la app pregunte antes de guardar.
 */
function exigirConfirmacion(req, pagadas) {
  if (!pagadas.length || confirmado(req)) return;
  const lista = pagadas.map(l => `N° ${String(l.numero).padStart(4, '0')} de ${l.nombreGanadero} (${textoRango(l.fechaInicio, l.fechaFin)}, pagada: $ ${Math.round(l.totalPagado ?? l.total).toLocaleString('es-CO')})`);
  const e = errorHttp(409,
    (pagadas.length === 1 ? 'Este cambio afecta una liquidación que ya está pagada: ' : 'Este cambio afecta liquidaciones que ya están pagadas: ')
    + lista.join('; ') + '. Si lo guardas, cambiará su total y quedará la diferencia con lo que se pagó.');
  e.requiereConfirmacion = true;
  throw e;
}

/** Recalcula las liquidaciones pagadas tras un cambio confirmado (las pendientes se recalculan solas). */
async function recalcularPagadas(pagadas) {
  for (const l of pagadas) await refrescar(l, { incluirPagadas: true });
}

module.exports = {
  redondear, precioDe, calcular, refrescar, confirmado, pagadasAfectadas, exigirConfirmacion, recalcularPagadas
};
