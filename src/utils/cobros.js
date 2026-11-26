// Ventas fiadas y abonos (cuentas por cobrar).
//
// Una venta fiada (`fiada: true`) se paga después con abonos. Lo que falta = total − abonos; cuando llega a 0 la
// venta está pagada. Las ventas sin `fiada` (todas las antiguas) están pagadas: no se modifican en la base.
// La venta cuenta en las ventas de la semana en que se hizo, aunque no la hayan pagado; lo que falta por cobrar
// se muestra aparte.
const { Types } = require('mongoose');
const { Venta, Abono } = require('../models');
const { errorHttp } = require('./inventario');
const { semanaDeFecha } = require('./semana');

const DIA_MS = 24 * 60 * 60 * 1000;
const r2 = (n) => Math.round(n * 100) / 100;

/** Map ventaId → total abonado, de las ventas [ventaIds]. */
async function abonadoPorVenta(usuarioId, ventaIds) {
  if (!ventaIds.length) return new Map();
  const filas = await Abono.aggregate([
    { $match: { usuarioId: new Types.ObjectId(String(usuarioId)), ventaId: { $in: ventaIds.map(id => new Types.ObjectId(String(id))) } } },
    { $group: { _id: '$ventaId', total: { $sum: '$valor' } } }
  ]);
  return new Map(filas.map(f => [String(f._id), Number(f.total)]));
}

/** Estado de cobro de una venta: { abonado, saldo, pagada }. */
function estadoDe(venta, abonado = 0) {
  if (!venta.fiada) return { abonado: 0, saldo: 0, pagada: true };
  const saldo = r2(Math.max(0, Number(venta.totalVenta) - abonado));
  return { abonado: r2(abonado), saldo, pagada: saldo <= 0 };
}

/** Las ventas (documentos o JSON) con su estado de cobro, listas para responder. */
async function conEstado(usuarioId, ventas) {
  const fiadas = ventas.filter(v => v.fiada).map(v => v._id);
  const mapa = await abonadoPorVenta(usuarioId, fiadas);
  return ventas.map(v => {
    const json = typeof v.toJSON === 'function' ? v.toJSON() : v;
    return { ...json, ...estadoDe(v, mapa.get(String(v._id)) || 0) };
  });
}

/** Venta fiada del usuario con su saldo; 404 si no existe, 400 si no es fiada. */
async function ventaFiada(usuarioId, ventaId) {
  const venta = Types.ObjectId.isValid(ventaId) ? await Venta.findOne({ _id: ventaId, usuarioId }) : null;
  if (!venta) throw errorHttp(404, 'Venta no encontrada');
  if (!venta.fiada) throw errorHttp(400, 'Esa venta está marcada como pagada: no recibe abonos');
  const abonado = (await abonadoPorVenta(usuarioId, [venta._id])).get(String(venta._id)) || 0;
  return { venta, ...estadoDe(venta, abonado) };
}

/** "$ 12.500" (para los mensajes). */
function pesos(n) {
  return '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO');
}

/**
 * Cuentas por cobrar: ventas fiadas con saldo, la más antigua primero, con sus abonos y los días que lleva.
 * [hoy]: fecha de hoy (día local de la app).
 */
async function cuentasPorCobrar(usuarioId, hoy = new Date()) {
  const ventas = await Venta.find({ usuarioId, fiada: true }).sort({ fecha: 1, createdAt: 1 }).lean();
  const abonos = ventas.length
    ? await Abono.find({ usuarioId, ventaId: { $in: ventas.map(v => v._id) } }).sort({ fecha: 1, createdAt: 1 }).lean()
    : [];
  const porVenta = new Map();
  for (const a of abonos) {
    const k = String(a.ventaId);
    if (!porVenta.has(k)) porVenta.set(k, []);
    porVenta.get(k).push({ _id: a._id, fecha: a.fecha, valor: Number(a.valor), nota: a.nota });
  }
  const hoyDia = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const cuentas = [];
  for (const v of ventas) {
    const lista = porVenta.get(String(v._id)) || [];
    const estado = estadoDe(v, lista.reduce((t, a) => t + a.valor, 0));
    if (estado.pagada) continue;
    const f = new Date(v.fecha);
    cuentas.push({
      ventaId: v._id, fecha: v.fecha, cliente: v.cliente || 'Cliente ocasional', clienteId: v.clienteId || null,
      cantidad: Number(v.cantidad), unidad: v.unidad, tipoVenta: v.tipoVenta,
      total: Number(v.totalVenta), ...estado,
      dias: Math.max(0, Math.floor((hoyDia - Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate())) / DIA_MS)),
      abonos: lista
    });
  }
  // Por cliente: cuánto debe y desde cuándo (su venta pendiente más antigua)
  const clientes = new Map();
  for (const c of cuentas) {
    const k = c.clienteId ? String(c.clienteId) : `nombre:${c.cliente}`;
    const x = clientes.get(k) || { clienteId: c.clienteId, cliente: c.cliente, debe: 0, ventas: 0, desde: c.fecha, dias: c.dias };
    x.debe = r2(x.debe + c.saldo);
    x.ventas += 1;
    clientes.set(k, x);
  }
  return {
    total: r2(cuentas.reduce((t, c) => t + c.saldo, 0)),
    cuentas,
    clientes: [...clientes.values()].sort((a, b) => b.debe - a.debe)
  };
}

/** Lo que debe un cliente (sus ventas fiadas con saldo). */
async function debeCliente(usuarioId, clienteId) {
  const ventas = await Venta.find({ usuarioId, clienteId, fiada: true }).select('totalVenta fiada').lean();
  const mapa = await abonadoPorVenta(usuarioId, ventas.map(v => v._id));
  return r2(ventas.reduce((t, v) => t + estadoDe(v, mapa.get(String(v._id)) || 0).saldo, 0));
}

/** Lo que falta por cobrar (hoy) de las ventas de cada semana: Map "anio-semana" → saldo. */
async function porCobrarPorSemana(usuarioId) {
  const ventas = await Venta.find({ usuarioId, fiada: true }).select('fecha totalVenta fiada').lean();
  const mapa = await abonadoPorVenta(usuarioId, ventas.map(v => v._id));
  const res = new Map();
  for (const v of ventas) {
    const saldo = estadoDe(v, mapa.get(String(v._id)) || 0).saldo;
    if (saldo <= 0) continue;
    const s = semanaDeFecha(new Date(v.fecha));
    const k = `${s.anio}-${s.semana}`;
    res.set(k, r2((res.get(k) || 0) + saldo));
  }
  return res;
}

module.exports = { abonadoPorVenta, estadoDe, conEstado, ventaFiada, cuentasPorCobrar, debeCliente, porCobrarPorSemana, pesos };
