// Registros hechos en el teléfono sin internet (utils/idLocal.js): la app los reenvía con el mismo idLocal
// hasta que el servidor responde. Cada uno debe quedar guardado UNA sola vez, aunque llegue repetido o
// varios envíos lleguen al mismo tiempo, y el inventario debe moverse una sola vez.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./ayuda');

describe('Subida de registros hechos sin internet (idLocal)', () => {
  let entorno, token, otro, ganaderoId, productoId;
  const llamar = (m, r, c, t = token) => entorno.api(m, r, c, t);
  const stock = async () => (await llamar('GET', '/productos')).body.data.find(p => p._id === productoId).stockKg;

  before(async () => {
    entorno = await iniciar();
    token = await entorno.crearUsuario('prueba_sin_internet');
    otro = await entorno.crearUsuario('prueba_sin_internet_2');
    ganaderoId = (await llamar('POST', '/ganaderos', { nombre: 'Ganadero A' })).body.data._id;
    productoId = (await llamar('POST', '/productos', { nombre: 'Queso costeño', stockInicialKg: 0 })).body.data._id;
  });
  after(async () => { await entorno.cerrar(); });

  test('leche: el mismo idLocal dos veces guarda un solo registro', async () => {
    const cuerpo = { idLocal: 'leche-0001-aaaa', fecha: '2026-11-03', litros: 120, ganaderoId };
    const a = await llamar('POST', '/leche', cuerpo);
    const b = await llamar('POST', '/leche', cuerpo);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.repetido, true);
    assert.equal(b.body.data._id, a.body.data._id);
    assert.equal(b.body.data.nombreGanadero, 'Ganadero A');
    const lista = (await llamar('GET', '/leche?limit=100')).body.data.filter(l => l.idLocal === 'leche-0001-aaaa');
    assert.equal(lista.length, 1);
  });

  test('producción: repetida no suma dos veces al inventario', async () => {
    const cuerpo = { idLocal: 'prod-0001-aaaa', fecha: '2026-11-03', litrosUsados: 100, kgProducidos: 10, productoId };
    await llamar('POST', '/produccion', cuerpo);
    const b = await llamar('POST', '/produccion', cuerpo);
    assert.equal(b.body.repetido, true);
    assert.equal(await stock(), 10);
  });

  test('venta: repetida no descuenta dos veces del inventario', async () => {
    const cuerpo = { idLocal: 'venta-0001-aaaa', fecha: '2026-11-04', tipoVenta: 'mayorista', cantidad: 3, unidad: 'kg', precioUnitario: 16000, productoId };
    const a = await llamar('POST', '/ventas', cuerpo);
    const b = await llamar('POST', '/ventas', cuerpo);
    assert.equal(a.status, 201);
    assert.equal(b.body.data._id, a.body.data._id);
    assert.equal(await stock(), 7);
    const ventas = (await llamar('GET', '/ventas?limit=100')).body.data.filter(v => v.idLocal === 'venta-0001-aaaa');
    assert.equal(ventas.length, 1);
  });

  test('cinco envíos al mismo tiempo de la misma venta guardan una sola', async () => {
    const cuerpo = { idLocal: 'venta-0002-aaaa', fecha: '2026-11-04', tipoVenta: 'mayorista', cantidad: 1, unidad: 'kg', precioUnitario: 16000, productoId };
    const respuestas = await Promise.all([1, 2, 3, 4, 5].map(() => llamar('POST', '/ventas', cuerpo)));
    assert.ok(respuestas.every(r => r.status === 200 || r.status === 201), JSON.stringify(respuestas.map(r => r.status)));
    const ids = new Set(respuestas.map(r => r.body.data._id));
    assert.equal(ids.size, 1);
    const ventas = (await llamar('GET', '/ventas?limit=100')).body.data.filter(v => v.idLocal === 'venta-0002-aaaa');
    assert.equal(ventas.length, 1);
    assert.equal(await stock(), 6);
  });

  test('sin idLocal se comporta como antes (dos envíos = dos registros)', async () => {
    const cuerpo = { fecha: '2026-11-05', litros: 50, ganaderoId };
    const a = await llamar('POST', '/leche', cuerpo);
    const b = await llamar('POST', '/leche', cuerpo);
    assert.notEqual(a.body.data._id, b.body.data._id);
  });

  test('una venta rechazada (sin stock) se puede reenviar después sin duplicarse', async () => {
    const cuerpo = { idLocal: 'venta-0003-aaaa', fecha: '2026-11-05', tipoVenta: 'mayorista', cantidad: 50, unidad: 'kg', precioUnitario: 16000, productoId };
    const rechazada = await llamar('POST', '/ventas', cuerpo);
    assert.equal(rechazada.status, 400);
    assert.match(rechazada.body.error, /Solo hay/);
    // Llega queso y el teléfono la reenvía (corregida) con el mismo idLocal
    await llamar('POST', '/produccion', { fecha: '2026-11-05', litrosUsados: 500, kgProducidos: 50, productoId });
    const a = await llamar('POST', '/ventas', cuerpo);
    const b = await llamar('POST', '/ventas', cuerpo);
    assert.equal(a.status, 201);
    assert.equal(b.body.repetido, true);
    assert.equal(await stock(), 6);
  });

  test('validación: los datos inválidos se rechazan con su mensaje aunque traigan idLocal', async () => {
    const r = await llamar('POST', '/leche', { idLocal: 'leche-0002-aaaa', fecha: '2026-11-03', litros: 0, ganaderoId });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /mayores que 0/);
  });

  test('idLocal con formato raro → 400 (no se usa para buscar)', async () => {
    const r = await llamar('POST', '/leche', { idLocal: { $ne: null }, litros: 10, ganaderoId });
    assert.equal(r.status, 400);
    const corto = await llamar('POST', '/leche', { idLocal: 'abc', litros: 10, ganaderoId });
    assert.equal(corto.status, 400);
  });

  test('el mismo idLocal de otro usuario es otro registro (no se mezclan cuentas)', async () => {
    const g2 = (await llamar('POST', '/ganaderos', { nombre: 'Ganadero B' }, otro)).body.data._id;
    const r = await llamar('POST', '/leche', { idLocal: 'leche-0001-aaaa', fecha: '2026-11-03', litros: 80, ganaderoId: g2 }, otro);
    assert.equal(r.status, 201);
    assert.equal(r.body.data.litros, 80);
  });
});
