// Ventas fiadas y abonos (utils/cobros.js, routes/abonos.js): pagada o pendiente, abonos parciales, cuentas por
// cobrar, lo que debe un cliente, "por cobrar" de la semana y seguridad (papelera / Deshacer). Base temporal en memoria.
//
// Números de la prueba (semana pasada, el lunes):
//   Venta fiada A: 10 kg × $ 10.000 = $ 100.000 a "Cliente F". Abonos: $ 30.000 → falta $ 70.000; luego $ 70.000 → pagada.
//   Venta fiada B: 4 kg × $ 12.500 = $ 50.000 al mismo cliente. Venta pagada C: 2 kg × $ 9.000 = $ 18.000.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, diaIso } = require('./ayuda');
const { semanaDeFecha, semanaAnterior, rangoSemana } = require('../src/utils/semana');

const hoy = semanaDeFecha(new Date());
const S = semanaAnterior(hoy.semana, hoy.anio);
const VIERNES = rangoSemana(S.semana, S.anio).inicio;
const LUNES = diaIso(VIERNES, 3);
const MARTES = diaIso(VIERNES, 4);
const DOMINGO = diaIso(VIERNES, 2);

describe('Ventas fiadas y abonos', () => {
  let entorno, token, otro, productoId, clienteId, ventaA, ventaB, abono1;
  const llamar = (m, r, c, t = token) => entorno.api(m, r, c, t);
  const venta = (cambios) => ({ fecha: LUNES, tipoVenta: 'mayorista', unidad: 'kg', productoId, clienteId, ...cambios });
  const porCobrar = async () => (await llamar('GET', `/ventas/por-cobrar?fecha=${MARTES}`)).body.data;
  const estado = async (id) => (await llamar('GET', `/ventas?desde=${LUNES}&hasta=${LUNES}T23:59:59Z`)).body.data.find(v => v._id === id);

  before(async () => {
    entorno = await iniciar();
    token = await entorno.crearUsuario('prueba_cobros');
    otro = await entorno.crearUsuario('prueba_cobros_2');
    productoId = (await llamar('POST', '/productos', { nombre: 'Queso F', stockInicialKg: 100 })).body.data._id;
    clienteId = (await llamar('POST', '/clientes', { nombre: 'Cliente F' })).body.data._id;
  });
  after(async () => { await entorno.cerrar(); });

  test('una venta sin "fiada" (como todas las antiguas) está pagada: falta $ 0', async () => {
    const r = await llamar('POST', '/ventas', venta({ cantidad: 2, precioUnitario: 9000 }));
    assert.equal(r.status, 201);
    assert.equal(r.body.data.fiada, undefined);
    assert.equal(r.body.data.pagada, true);
    assert.equal(r.body.data.saldo, 0);
  });

  test('venta pendiente por pagar sin cliente → 400; "fiada" que no es sí/no → 400', async () => {
    const r = await llamar('POST', '/ventas', venta({ cantidad: 1, precioUnitario: 9000, fiada: true, clienteId: undefined }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /elige el cliente/);
    const r2 = await llamar('POST', '/ventas', venta({ cantidad: 1, precioUnitario: 9000, fiada: 'si' }));
    assert.equal(r2.status, 400);
  });

  test('venta fiada de $ 100.000: queda pendiente, falta $ 100.000', async () => {
    const r = await llamar('POST', '/ventas', venta({ cantidad: 10, precioUnitario: 10000, fiada: true }));
    assert.equal(r.status, 201);
    ventaA = r.body.data._id;
    assert.equal(r.body.data.fiada, true);
    assert.equal(r.body.data.totalVenta, 100000);
    assert.equal(r.body.data.saldo, 100000);
    assert.equal(r.body.data.pagada, false);
  });

  test('abono de $ 30.000 → falta $ 70.000; abonos inválidos → 400', async () => {
    const r = await llamar('POST', '/abonos', { ventaId: ventaA, fecha: MARTES, valor: 30000, nota: 'efectivo' });
    assert.equal(r.status, 201);
    abono1 = r.body.data.abono._id;
    assert.deepEqual(r.body.data.venta, { _id: ventaA, total: 100000, abonado: 30000, saldo: 70000, pagada: false });

    const mayor = await llamar('POST', '/abonos', { ventaId: ventaA, fecha: MARTES, valor: 80000 });
    assert.equal(mayor.status, 400);
    assert.match(mayor.body.error, /Solo falta \$ 70\.000/);
    assert.equal((await llamar('POST', '/abonos', { ventaId: ventaA, valor: 0 })).status, 400);
    assert.equal((await llamar('POST', '/abonos', { ventaId: ventaA, valor: -5 })).status, 400);
    const antes = await llamar('POST', '/abonos', { ventaId: ventaA, fecha: DOMINGO, valor: 1000 });
    assert.equal(antes.status, 400);
    assert.match(antes.body.error, /antes de la venta/);
    // A una venta pagada no se le abona; otro usuario no ve la venta
    const pagada = (await llamar('GET', `/ventas?desde=${LUNES}&hasta=${LUNES}T23:59:59Z`)).body.data.find(v => !v.fiada);
    assert.equal((await llamar('POST', '/abonos', { ventaId: pagada._id, valor: 1000 })).status, 400);
    assert.equal((await llamar('POST', '/abonos', { ventaId: ventaA, valor: 1000 }, otro)).status, 404);
  });

  test('cuentas por cobrar: $ 70.000 de Cliente F, desde el lunes (1 día), con su abono', async () => {
    const d = await porCobrar();
    assert.equal(d.total, 70000);
    assert.equal(d.cuentas.length, 1);
    const c = d.cuentas[0];
    assert.equal(c.cliente, 'Cliente F');
    assert.equal(c.total, 100000);
    assert.equal(c.abonado, 30000);
    assert.equal(c.saldo, 70000);
    assert.equal(c.dias, 1);
    assert.equal(c.abonos.length, 1);
    assert.equal(c.abonos[0].valor, 30000);
    assert.equal(c.abonos[0].nota, 'efectivo');
    assert.deepEqual(d.clientes.map(x => [x.cliente, x.debe, x.ventas]), [['Cliente F', 70000, 1]]);
    // El otro usuario no debe nada
    assert.equal((await llamar('GET', '/ventas/por-cobrar', undefined, otro)).body.data.total, 0);
  });

  test('el cliente "te debe" $ 70.000 (detalle y lista); sus ventas traen el saldo', async () => {
    assert.equal((await llamar('GET', `/clientes/${clienteId}`)).body.data.debe, 70000);
    assert.equal((await llamar('GET', '/clientes')).body.data.find(c => c._id === clienteId).debe, 70000);
    const ventas = (await llamar('GET', `/clientes/${clienteId}/ventas`)).body.data;
    assert.equal(ventas.find(v => v._id === ventaA).saldo, 70000);
  });

  test('la venta cuenta entera en las ventas de su semana; aparte, por cobrar $ 70.000', async () => {
    const s = (await llamar('GET', `/resumen/semanas?n=1&hasta=${LUNES}`)).body.data[0];
    assert.equal(s.ingresos, 118000); // 18.000 pagada + 100.000 fiada
    assert.equal(s.porCobrar, 70000);
    const g = (await llamar('GET', `/resumen/ganancias?semana=${S.semana}&anio=${S.anio}`)).body.data;
    assert.equal(g.semanaActual.ingresos, 118000);
    assert.equal(g.semanaActual.porCobrar, 70000);
    assert.equal((await llamar('GET', '/resumen/hoy')).body.data.porCobrarTotal, 70000);
  });

  test('corregir la venta: no se puede dejar pagada con abonos ni bajar el total de lo abonado', async () => {
    const pagar = await llamar('PUT', `/ventas/${ventaA}`, { fiada: false });
    assert.equal(pagar.status, 400);
    assert.match(pagar.body.error, /registra un abono por lo que falta/);
    const bajar = await llamar('PUT', `/ventas/${ventaA}`, { cantidad: 2 }); // $ 20.000 < $ 30.000 abonados
    assert.equal(bajar.status, 400);
    assert.match(bajar.body.error, /Ya te abonaron \$ 30\.000/);
    // Subir el precio sí: total $ 110.000 − $ 30.000 = falta $ 80.000; y se devuelve como estaba
    const subir = await llamar('PUT', `/ventas/${ventaA}`, { precioUnitario: 11000 });
    assert.equal(subir.status, 200);
    assert.equal(subir.body.data.saldo, 80000);
    assert.equal((await llamar('PUT', `/ventas/${ventaA}`, { precioUnitario: 10000 })).body.data.saldo, 70000);
  });

  test('corregir un abono: $ 30.000 → $ 50.000 deja faltando $ 50.000; más de $ 100.000 → 400', async () => {
    const r = await llamar('PUT', `/abonos/${abono1}`, { valor: 50000 });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.venta.saldo, 50000);
    const mucho = await llamar('PUT', `/abonos/${abono1}`, { valor: 100001 });
    assert.equal(mucho.status, 400);
    assert.equal((await llamar('PUT', `/abonos/${abono1}`, { valor: 30000 })).body.data.venta.saldo, 70000);
  });

  test('abono por lo que falta ($ 70.000) → la venta queda pagada y sale de cuentas por cobrar', async () => {
    const r = await llamar('POST', '/abonos', { ventaId: ventaA, fecha: MARTES, valor: 70000 });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.venta.saldo, 0);
    assert.equal(r.body.data.venta.pagada, true);
    assert.equal((await estado(ventaA)).pagada, true);
    assert.equal((await porCobrar()).total, 0);
    assert.equal((await llamar('POST', '/abonos', { ventaId: ventaA, valor: 1 })).status, 400);
  });

  test('borrar un abono → papelera; la venta vuelve a deber $ 30.000; Deshacer lo restaura', async () => {
    const b = await llamar('DELETE', `/abonos/${abono1}`);
    assert.equal(b.status, 200);
    assert.ok(b.body.papeleraId);
    assert.equal((await estado(ventaA)).saldo, 30000);
    const entrada = (await llamar('GET', '/papelera')).body.data.find(e => e._id === b.body.papeleraId);
    assert.equal(entrada.tipo, 'abono');
    assert.equal(entrada.resumen.nombre, 'Cliente F');
    assert.equal(entrada.resumen.valor, 30000);
    const r = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(r.status, 200);
    assert.equal((await estado(ventaA)).saldo, 0);
  });

  test('restaurar un abono que ya no cabe (la venta se pagó por otro lado) → 409, sigue en la papelera', async () => {
    const b = await llamar('DELETE', `/abonos/${abono1}`); // falta $ 30.000
    await llamar('POST', '/abonos', { ventaId: ventaA, fecha: MARTES, valor: 30000 }); // pagada otra vez
    const r = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(r.status, 409);
    assert.match(r.body.error, /ya está pagada/);
    assert.ok((await llamar('GET', '/papelera')).body.data.some(e => e._id === b.body.papeleraId));
  });

  test('borrar una venta fiada se lleva sus abonos a la papelera; Deshacer los trae de vuelta', async () => {
    ventaB = (await llamar('POST', '/ventas', venta({ cantidad: 4, precioUnitario: 12500, fiada: true }))).body.data._id;
    const a = (await llamar('POST', '/abonos', { ventaId: ventaB, fecha: MARTES, valor: 20000 })).body.data.abono;
    assert.equal((await porCobrar()).total, 30000);
    const b = await llamar('DELETE', `/ventas/${ventaB}`);
    assert.equal(b.status, 200);
    assert.equal((await llamar('GET', `/abonos?ventaId=${ventaB}`)).body.data.length, 0);
    assert.equal((await porCobrar()).total, 0);
    const r = await llamar('POST', `/papelera/${b.body.papeleraId}/restaurar`, {});
    assert.equal(r.status, 200);
    const abonos = (await llamar('GET', `/abonos?ventaId=${ventaB}`)).body.data;
    assert.equal(abonos.length, 1);
    assert.equal(abonos[0]._id, a._id);
    assert.equal(abonos[0].createdAt, a.createdAt);
    assert.equal((await porCobrar()).total, 30000);
  });

  test('una fiada sin abonos se puede dejar como pagada (y al revés)', async () => {
    const id = (await llamar('POST', '/ventas', venta({ cantidad: 1, precioUnitario: 10000, fiada: true }))).body.data._id;
    const r = await llamar('PUT', `/ventas/${id}`, { fiada: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.pagada, true);
    assert.equal(r.body.data.fiada, undefined);
    const r2 = await llamar('PUT', `/ventas/${id}`, { fiada: true });
    assert.equal(r2.body.data.saldo, 10000);
  });
});
