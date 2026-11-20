// Papelera (utils/papelera.js): lo que se borra queda 30 días en la colección `papelera` y se puede
// restaurar ("Deshacer") con el mismo _id, rehaciendo inventario y liquidaciones. Base temporal en memoria.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, diaIso } = require('./ayuda');
const { semanaDeFecha, semanaAnterior, rangoSemana } = require('../src/utils/semana');

const hoy = semanaDeFecha(new Date());
const S = semanaAnterior(hoy.semana, hoy.anio); // la semana pasada (cerrada)
const VIERNES = rangoSemana(S.semana, S.anio).inicio;
const LUNES = diaIso(VIERNES, 3);

describe('Papelera: borrar, deshacer y restaurar', () => {
  let entorno, token, otro, ganaderoId, productoId;
  const llamar = (m, r, c, t = token) => entorno.api(m, r, c, t);
  const stock = async () => (await llamar('GET', '/productos')).body.data.find(p => p._id === productoId).stockKg;
  const papelera = async (t = token) => (await llamar('GET', '/papelera', undefined, t)).body.data;

  before(async () => {
    entorno = await iniciar();
    token = await entorno.crearUsuario('prueba_papelera');
    otro = await entorno.crearUsuario('prueba_papelera_2');
    ganaderoId = (await llamar('POST', '/ganaderos', { nombre: 'Ganadero P' })).body.data._id;
    productoId = (await llamar('POST', '/productos', { nombre: 'Queso P', stockInicialKg: 0 })).body.data._id;
  });
  after(async () => { await entorno.cerrar(); });

  test('borrar leche la deja en la papelera con su resumen; restaurar la vuelve a crear igual', async () => {
    const creada = (await llamar('POST', '/leche', { fecha: LUNES, litros: 45, ganaderoId, observaciones: 'tarde' })).body.data;
    const b = await llamar('DELETE', `/leche/${creada._id}`);
    assert.equal(b.status, 200);
    assert.ok(b.body.papeleraId);
    const lista = (await llamar('GET', `/leche?desde=${LUNES}&hasta=${LUNES}`)).body.data;
    assert.equal(lista.length, 0);

    const entrada = (await papelera()).find(e => e._id === b.body.papeleraId);
    assert.equal(entrada.tipo, 'leche');
    assert.equal(entrada.resumen.nombre, 'Ganadero P');
    assert.equal(entrada.resumen.cantidad, '45 L');
    assert.equal(entrada.registroId, creada._id);
    const dias = Math.round((new Date(entrada.expiraEn) - new Date(entrada.borradoEn)) / 86400000);
    assert.equal(dias, 30);

    const r = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(r.status, 200);
    const vuelta = (await llamar('GET', `/leche?desde=${LUNES}&hasta=${LUNES}`)).body.data;
    assert.equal(vuelta.length, 1);
    assert.equal(vuelta[0]._id, creada._id);
    assert.equal(vuelta[0].litros, 45);
    assert.equal(vuelta[0].observaciones, 'tarde');
    assert.equal(vuelta[0].createdAt, creada.createdAt);
    // Ya no está en la papelera y no se puede restaurar dos veces
    assert.ok(!(await papelera()).some(e => e._id === b.body.papeleraId));
    const otra = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(otra.status, 404);
  });

  test('producción: borrar quita el queso del inventario y restaurar lo vuelve a sumar', async () => {
    const p = (await llamar('POST', '/produccion', { fecha: LUNES, litrosUsados: 100, kgProducidos: 10, productoId })).body.data;
    assert.equal(await stock(), 10);
    const b = await llamar('DELETE', `/produccion/${p._id}`);
    assert.equal(await stock(), 0);
    await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(await stock(), 10);
    const lista = (await llamar('GET', '/produccion?limit=50')).body.data;
    assert.equal(lista.find(x => x._id === p._id).rendimiento, p.rendimiento);
  });

  test('venta: borrar devuelve el queso; restaurar lo vuelve a descontar', async () => {
    const v = (await llamar('POST', '/ventas', { fecha: LUNES, tipoVenta: 'mayorista', cantidad: 4, unidad: 'kg', precioUnitario: 16000, productoId, cliente: 'Tienda' })).body.data;
    assert.equal(await stock(), 6);
    const b = await llamar('DELETE', `/ventas/${v._id}`);
    assert.equal(await stock(), 10);
    const entrada = (await papelera()).find(e => e._id === b.body.papeleraId);
    assert.equal(entrada.resumen.nombre, 'Tienda');
    assert.equal(entrada.resumen.valor, 64000);
    const r = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(r.status, 200);
    assert.equal(await stock(), 6);
  });

  test('venta sin stock suficiente para restaurar: no se restaura y sigue en la papelera', async () => {
    const v = (await llamar('POST', '/ventas', { fecha: LUNES, tipoVenta: 'mayorista', cantidad: 5, unidad: 'kg', precioUnitario: 16000, productoId })).body.data;
    assert.equal(await stock(), 1);
    const b = await llamar('DELETE', `/ventas/${v._id}`);
    assert.equal(await stock(), 6);
    // Mientras tanto se vendió otro queso
    await llamar('POST', '/ventas', { fecha: LUNES, tipoVenta: 'mayorista', cantidad: 3, unidad: 'kg', precioUnitario: 16000, productoId });
    const r = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Solo hay 3/);
    assert.equal(await stock(), 3);
    assert.ok((await papelera()).some(e => e._id === b.body.papeleraId));
    const ventas = (await llamar('GET', '/ventas?limit=100')).body.data;
    assert.ok(!ventas.some(x => x._id === v._id));
  });

  test('descuento: borrar y restaurar', async () => {
    const d = (await llamar('POST', '/descuentos', { ganaderoId, fecha: LUNES, tipo: 'adelanto', valor: 20000 })).body.data;
    const b = await llamar('DELETE', `/descuentos/${d._id}`);
    assert.equal((await llamar('GET', `/descuentos?ganaderoId=${ganaderoId}`)).body.data.length, 0);
    const entrada = (await papelera()).find(e => e._id === b.body.papeleraId);
    assert.equal(entrada.resumen.cantidad, 'Adelanto');
    assert.equal(entrada.resumen.valor, 20000);
    await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal((await llamar('GET', `/descuentos?ganaderoId=${ganaderoId}`)).body.data[0]._id, d._id);
  });

  test('liquidación anulada: se restaura con su mismo número y deja de figurar como anulada', async () => {
    await llamar('PUT', '/liquidaciones/precio', { semana: S.semana, anio: S.anio, precioLitro: 2000 });
    const liq = (await llamar('POST', '/liquidaciones', { ganaderoId, semana: S.semana, anio: S.anio })).body.data;
    const b = await llamar('DELETE', `/liquidaciones/${liq._id}`);
    assert.equal(b.status, 200);
    const anuladas = await entorno.mongoose.connection.collection('liquidaciones_anuladas').countDocuments({ numero: liq.numero });
    assert.equal(anuladas, 1);
    const r = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(r.status, 200);
    const vuelta = (await llamar('GET', `/liquidaciones/${liq._id}`)).body.data;
    assert.equal(vuelta.numero, liq.numero);
    assert.equal(vuelta.total, 45 * 2000 - 20000);
    assert.equal(await entorno.mongoose.connection.collection('liquidaciones_anuladas').countDocuments({ numero: liq.numero }), 0);
  });

  test('leche de una semana ya pagada: restaurarla pide confirmación', async () => {
    const liq = (await llamar('GET', `/liquidaciones?ganaderoId=${ganaderoId}`)).body.data[0];
    const l = (await llamar('POST', '/leche', { fecha: LUNES, litros: 10, ganaderoId })).body.data;
    await llamar('PUT', `/liquidaciones/${liq._id}/pagar`, { formaPago: 'efectivo' });
    const b = await llamar('DELETE', `/leche/${l._id}?confirmar=true`);
    assert.equal(b.status, 200);
    const sin = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(sin.status, 409);
    assert.equal(sin.body.requiereConfirmacion, true);
    const con = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, { confirmar: true });
    assert.equal(con.status, 200);
    const pagada = (await llamar('GET', `/liquidaciones/${liq._id}`)).body.data;
    assert.equal(pagada.litros, 55);
    assert.equal(pagada.estado, 'pagado');
  });

  test('cada usuario solo ve y restaura lo suyo', async () => {
    const mias = await papelera();
    assert.ok(mias.length > 0);
    assert.equal((await papelera(otro)).length, 0);
    const r = await llamar('POST', `/papelera/${mias[0]._id}/restaurar`, {}, otro);
    assert.equal(r.status, 404);
  });

  test('la colección tiene el índice que la vacía sola a los 30 días', async () => {
    const indices = await entorno.mongoose.connection.collection('papelera').indexes();
    const ttl = indices.find(i => i.key.expiraEn === 1);
    assert.equal(ttl.expireAfterSeconds, 0);
  });
});
