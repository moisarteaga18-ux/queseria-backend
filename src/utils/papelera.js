// Papelera: antes de borrar un registro se guarda una copia en la colección `papelera` (30 días).
// Restaurar lo vuelve a crear con el MISMO _id y rehace lo que su borrado deshizo (inventario,
// liquidaciones pagadas). Ningún otro registro existente se modifica para guardar en la papelera.
const { Leche, Produccion, Venta, Descuento, Liquidacion, LiquidacionAnulada, Ganadero, Papelera } = require('../models');
const { errorHttp, registrarMovimiento } = require('./inventario');
const { pagadasAfectadas, exigirConfirmacion, recalcularPagadas, refrescar } = require('./liquidacion');
const { semanaDeFecha } = require('./semana');
const { aKg } = require('./unidades');

const MODELOS = { leche: Leche, produccion: Produccion, venta: Venta, descuento: Descuento, liquidacion: Liquidacion };

const TIPOS_DESCUENTO = { adelanto: 'Adelanto', prestamo: 'Préstamo', leche_rechazada: 'Leche rechazada', otro: 'Otro descuento' };

/** 1234.5 → "1.234,5" (como en la app). */
function numero(n, decimales = 2) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: decimales });
}

async function nombreGanadero(usuarioId, ganaderoId) {
  if (!ganaderoId) return 'Sin ganadero';
  const g = await Ganadero.findOne({ _id: ganaderoId, usuarioId }).lean();
  return g ? g.nombre : 'Ganadero';
}

/** Lo que se muestra del registro: fecha, nombre, cantidad y valor. */
async function resumenDe(tipo, d) {
  switch (tipo) {
    case 'leche':
      return { fecha: d.fecha, nombre: await nombreGanadero(d.usuarioId, d.ganaderoId), cantidad: `${numero(d.litros, 1)} L` };
    case 'produccion':
      return { fecha: d.fecha, nombre: 'Producción', cantidad: `${numero(d.kgProducidos)} kg de ${numero(d.litrosUsados, 1)} L` };
    case 'venta':
      return {
        fecha: d.fecha, nombre: d.cliente || 'Cliente ocasional',
        cantidad: `${numero(d.cantidad)} ${d.unidad === 'libras' ? 'lb' : 'kg'}`, valor: d.totalVenta
      };
    case 'descuento':
      return {
        fecha: d.fecha, nombre: await nombreGanadero(d.usuarioId, d.ganaderoId),
        cantidad: TIPOS_DESCUENTO[d.tipo] + (d.tipo === 'leche_rechazada' ? ` · ${numero(d.litros, 1)} L` : ''),
        valor: d.tipo === 'leche_rechazada' ? undefined : d.valor
      };
    case 'liquidacion':
      return {
        fecha: d.fechaInicio, nombre: d.nombreGanadero,
        cantidad: `N° ${String(d.numero).padStart(4, '0')} · semana ${d.semana} · ${numero(d.litros, 1)} L`, valor: d.total
      };
    default:
      return {};
  }
}

/** Guarda una copia del registro [doc] (documento de Mongoose) en la papelera y devuelve la entrada. */
async function guardarEnPapelera(usuarioId, tipo, doc) {
  const documento = doc.toObject({ getters: true, virtuals: false });
  return Papelera.create({ usuarioId, tipo, documento, resumen: await resumenDe(tipo, documento) });
}

/**
 * Borra [doc] dejando antes su copia en la papelera. Si el borrado falla, la copia se quita.
 * Devuelve el _id de la entrada de la papelera (la app lo usa para "Deshacer").
 */
async function borrarConPapelera(usuarioId, tipo, doc) {
  const entrada = await guardarEnPapelera(usuarioId, tipo, doc);
  try {
    await doc.deleteOne();
  } catch (e) {
    await entrada.deleteOne().catch(() => {});
    throw e;
  }
  return entrada._id;
}

/** Los descuentos de una semana ya pagada no se pueden cambiar (el comprobante ya se entregó). */
async function validarSemanaAbierta(usuarioId, ganaderoId, fecha) {
  const { semana, anio } = semanaDeFecha(new Date(fecha));
  const pagada = await Liquidacion.findOne({ usuarioId, ganaderoId, semana, anio, estado: 'pagado' });
  if (pagada) throw errorHttp(400, `La liquidación N° ${pagada.numero} de esa semana ya está pagada`);
}

/**
 * Vuelve a crear el registro de una entrada de la papelera y rehace sus efectos.
 * Si algo no se puede (sin stock, semana pagada sin confirmar, ya existe), no queda nada a medias.
 */
async function restaurar(req, entrada) {
  const { tipo } = entrada;
  const Modelo = MODELOS[tipo];
  const d = entrada.documento;
  const usuarioId = req.usuarioId;
  if (String(d.usuarioId) !== String(usuarioId)) throw errorHttp(404, 'Registro no encontrado');
  if (await Modelo.exists({ _id: d._id })) throw errorHttp(409, 'Ese registro ya está restaurado');

  let pagadas = [];
  if (tipo === 'leche') {
    if (!(await Ganadero.exists({ _id: d.ganaderoId, usuarioId }))) {
      throw errorHttp(409, 'El ganadero de ese registro ya no existe: créalo de nuevo y registra la leche');
    }
    // Si la semana ya se pagó, se pide confirmación igual que al registrar leche nueva
    pagadas = await pagadasAfectadas(usuarioId, [{ ganaderoId: d.ganaderoId, fecha: d.fecha }]);
    exigirConfirmacion(req, pagadas);
  }
  if (tipo === 'descuento') await validarSemanaAbierta(usuarioId, d.ganaderoId, d.fecha);
  if (tipo === 'liquidacion') {
    const otra = await Liquidacion.findOne({ usuarioId, ganaderoId: d.ganaderoId, semana: d.semana, anio: d.anio });
    if (otra) {
      throw errorHttp(409, `Ese ganadero ya tiene otra liquidación (N° ${String(otra.numero).padStart(4, '0')}) en esa semana`);
    }
  }

  const doc = new Modelo(d);
  try {
    // timestamps: false = conserva las fechas de creación y modificación originales
    await doc.save({ timestamps: false });
  } catch (e) {
    if (e?.code === 11000) throw errorHttp(409, 'Ese registro ya se volvió a guardar (por ejemplo, desde el teléfono sin internet)');
    throw e;
  }

  try {
    if (tipo === 'produccion' && d.productoId) {
      await registrarMovimiento(usuarioId, {
        productoId: d.productoId, tipo: 'ENTRADA', cantidadKg: Number(d.kgProducidos),
        motivo: 'Producción', referencia: doc._id, fecha: doc.fecha
      });
    }
    if (tipo === 'venta' && d.productoId) {
      await registrarMovimiento(usuarioId, {
        productoId: d.productoId, tipo: 'SALIDA', cantidadKg: -aKg(Number(d.cantidad), d.unidad),
        motivo: 'Venta' + (d.cliente ? ` a ${d.cliente}` : ''), referencia: doc._id, fecha: doc.fecha
      });
    }
  } catch (e) {
    // Sin stock (u otro problema con el inventario): el registro no se restaura
    await doc.deleteOne();
    throw e;
  }

  if (tipo === 'leche') await recalcularPagadas(pagadas);
  if (tipo === 'liquidacion') {
    // Ya no está anulada; si estaba pendiente se recalcula con la leche y los descuentos de hoy
    await LiquidacionAnulada.deleteMany({ usuarioId, numero: d.numero });
    await refrescar(doc);
  }
  await entrada.deleteOne();
  return doc;
}

module.exports = { guardarEnPapelera, borrarConPapelera, restaurar, validarSemanaAbierta, resumenDe };
