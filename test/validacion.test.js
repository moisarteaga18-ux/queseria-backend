// Defecto D-17 (encontrado el 18 nov 2026): la API aceptaba producción con litros y kilos negativos.
// Estas pruebas comprueban que leche, producción, ventas y precios rechazan valores negativos, en
// cero o que no son números, con un mensaje claro, y que en ese caso no se guarda nada.
// Corre contra una MongoDB temporal en memoria (ver test/ayuda.js), nunca contra la base real.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, diaIso } = require('./ayuda');
const { semanaDeFecha, rangoSemana } = require('../src/utils/semana');
const { positivo, positivoOpcional } = require('../src/utils/validar');

const hoy = semanaDeFecha(new Date());
const VIERNES = rangoSemana(hoy.semana, hoy.anio).inicio;
const FECHA = diaIso(VIERNES);

let entorno, token, ganaderoId, productoId, lecheId, produccionId, ventaId;
const llamar = (metodo, ruta, cuerpo) => entorno.api(metodo, ruta, cuerpo, token);

/** Comprueba que la respuesta sea 400 con exactamente ese mensaje. */
function rechazo(r, mensaje) {
  assert.equal(r.status, 400, `se esperaba 400 y llegó ${r.status}: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, mensaje);
}

before(async () => {
  entorno = await iniciar();
  token = await entorno.crearUsuario('prueba_validacion');
  ganaderoId = (await llamar('POST', '/ganaderos', { nombre: 'Ganadero B' })).body.data._id;
  productoId = (await llamar('POST', '/productos', { nombre: 'Queso', stockInicialKg: 50 })).body.data._id;
});
after(async () => { await entorno.cerrar(); });

describe('utils/validar.js', () => {
  test('acepta números y texto numérico mayores que 0', () => {
    assert.equal(positivo(12.5, 'litros'), 12.5);
    assert.equal(positivo('7', 'litros'), 7);
  });

  test('mensajes: falta, no es número, no es mayor que 0 (singular y plural)', () => {
    assert.throws(() => positivo(undefined, 'litros'), { message: 'Faltan los litros', status: 400 });
    assert.throws(() => positivo('', 'precioLitro'), { message: 'Falta el precio del litro' });
    assert.throws(() => positivo('abc', 'cantidad'), { message: 'La cantidad vendida debe ser un número' });
    assert.throws(() => positivo(true, 'litros'), { message: 'Los litros deben ser un número' });
    assert.throws(() => positivo('1e400', 'litros'), { message: 'Los litros deben ser un número' });
    assert.throws(() => positivo(0, 'kgProducidos'), { message: 'Los kilos producidos deben ser mayores que 0' });
    assert.throws(() => positivo(-1, 'precioPorKg'), { message: 'El precio minorista debe ser mayor que 0' });
  });

  test('positivoOpcional: vacío → null; con valor, valida igual', () => {
    assert.equal(positivoOpcional(null, 'precioPorKg'), null);
    assert.equal(positivoOpcional('', 'precioPorKg'), null);
    assert.equal(positivoOpcional(3000, 'precioPorKg'), 3000);
    assert.throws(() => positivoOpcional(-5, 'precioPorKg'), { message: 'El precio minorista debe ser mayor que 0' });
  });
});

describe('Leche', () => {
  test('POST con litros negativos → 400 "Los litros deben ser mayores que 0"', async () => {
    rechazo(await llamar('POST', '/leche', { fecha: FECHA, litros: -5, ganaderoId }), 'Los litros deben ser mayores que 0');
  });

  test('POST con 0 litros → 400', async () => {
    rechazo(await llamar('POST', '/leche', { fecha: FECHA, litros: 0, ganaderoId }), 'Los litros deben ser mayores que 0');
  });

  test('POST con litros "abc" → 400 "Los litros deben ser un número"', async () => {
    rechazo(await llamar('POST', '/leche', { fecha: FECHA, litros: 'abc', ganaderoId }), 'Los litros deben ser un número');
  });

  test('POST sin litros → 400 "Faltan los litros"', async () => {
    rechazo(await llamar('POST', '/leche', { fecha: FECHA, ganaderoId }), 'Faltan los litros');
  });

  test('ningún registro rechazado quedó guardado', async () => {
    assert.equal((await llamar('GET', '/leche')).body.data.length, 0);
  });

  test('POST válido (12,5 L) → 201', async () => {
    const r = await llamar('POST', '/leche', { fecha: FECHA, litros: 12.5, ganaderoId });
    assert.equal(r.status, 201);
    lecheId = r.body.data._id;
  });

  test('PUT con litros negativos → 400 y el registro sigue con 12,5 L', async () => {
    rechazo(await llamar('PUT', `/leche/${lecheId}`, { litros: -1 }), 'Los litros deben ser mayores que 0');
    const lista = (await llamar('GET', '/leche')).body.data;
    assert.equal(lista.find(l => l._id === lecheId).litros, 12.5);
  });
});

describe('Producción', () => {
  test('D-17: POST con litros −50 y kilos −5 → 400 (antes respondía 201)', async () => {
    rechazo(await llamar('POST', '/produccion', { fecha: FECHA, litrosUsados: -50, kgProducidos: -5 }),
      'Los litros usados deben ser mayores que 0');
  });

  test('POST con kilos negativos → 400 "Los kilos producidos deben ser mayores que 0"', async () => {
    rechazo(await llamar('POST', '/produccion', { fecha: FECHA, litrosUsados: 100, kgProducidos: -5 }),
      'Los kilos producidos deben ser mayores que 0');
  });

  test('POST con 0 litros → 400', async () => {
    rechazo(await llamar('POST', '/produccion', { fecha: FECHA, litrosUsados: 0, kgProducidos: 10 }),
      'Los litros usados deben ser mayores que 0');
  });

  test('POST con kilos "diez" → 400 "Los kilos producidos deben ser un número"', async () => {
    rechazo(await llamar('POST', '/produccion', { fecha: FECHA, litrosUsados: 100, kgProducidos: 'diez' }),
      'Los kilos producidos deben ser un número');
  });

  test('ninguna producción rechazada quedó guardada y el stock no cambió (50 kg)', async () => {
    assert.equal((await llamar('GET', '/produccion')).body.data.length, 0);
    const producto = (await llamar('GET', '/productos')).body.data.find(p => p._id === productoId);
    assert.equal(producto.stockKg, 50);
  });

  test('POST válido → 201', async () => {
    const r = await llamar('POST', '/produccion', { fecha: FECHA, litrosUsados: 100, kgProducidos: 10 });
    assert.equal(r.status, 201);
    produccionId = r.body.data._id;
  });

  test('PUT con kilos en 0 → 400', async () => {
    rechazo(await llamar('PUT', `/produccion/${produccionId}`, { kgProducidos: 0 }), 'Los kilos producidos deben ser mayores que 0');
  });

  test('el modelo también lo impide (última defensa): Produccion con litros negativos no se guarda', async () => {
    const { Produccion } = require('../src/models');
    await assert.rejects(
      Produccion.create({ usuarioId: new entorno.mongoose.Types.ObjectId(), litrosUsados: -1, kgProducidos: 5 }),
      { name: 'ValidationError' }
    );
  });
});

describe('Ventas', () => {
  const venta = (cambios) => ({ fecha: FECHA, tipoVenta: 'libras', cantidad: 2, unidad: 'libras', precioUnitario: 9000, productoId, ...cambios });

  test('POST con cantidad negativa → 400 "La cantidad vendida debe ser mayor que 0"', async () => {
    rechazo(await llamar('POST', '/ventas', venta({ cantidad: -3 })), 'La cantidad vendida debe ser mayor que 0');
  });

  test('POST con cantidad 0 → 400', async () => {
    rechazo(await llamar('POST', '/ventas', venta({ cantidad: 0 })), 'La cantidad vendida debe ser mayor que 0');
  });

  test('POST con precio negativo → 400 "El precio de la venta debe ser mayor que 0"', async () => {
    rechazo(await llamar('POST', '/ventas', venta({ precioUnitario: -9000 })), 'El precio de la venta debe ser mayor que 0');
  });

  test('POST con precio 0 → 400', async () => {
    rechazo(await llamar('POST', '/ventas', venta({ precioUnitario: 0 })), 'El precio de la venta debe ser mayor que 0');
  });

  test('POST con cantidad "abc" → 400 "La cantidad vendida debe ser un número"', async () => {
    rechazo(await llamar('POST', '/ventas', venta({ cantidad: 'abc' })), 'La cantidad vendida debe ser un número');
  });

  test('POST sin tipo de venta → 400 con mensaje claro', async () => {
    rechazo(await llamar('POST', '/ventas', venta({ tipoVenta: undefined })), 'Elige el tipo de venta (mayorista o minorista)');
  });

  test('ninguna venta rechazada quedó guardada y el stock sigue en 50 kg', async () => {
    assert.equal((await llamar('GET', '/ventas')).body.data.length, 0);
    const producto = (await llamar('GET', '/productos')).body.data.find(p => p._id === productoId);
    assert.equal(producto.stockKg, 50);
  });

  test('POST válido → 201 y el stock baja 1 kg', async () => {
    const r = await llamar('POST', '/ventas', venta({}));
    assert.equal(r.status, 201);
    ventaId = r.body.data._id;
    const producto = (await llamar('GET', '/productos')).body.data.find(p => p._id === productoId);
    assert.equal(producto.stockKg, 49);
  });

  test('PUT con precio negativo → 400 y la venta no cambia', async () => {
    rechazo(await llamar('PUT', `/ventas/${ventaId}`, { precioUnitario: -1 }), 'El precio de la venta debe ser mayor que 0');
    const v = (await llamar('GET', '/ventas')).body.data.find(x => x._id === ventaId);
    assert.equal(v.precioUnitario, 9000);
    assert.equal(v.totalVenta, 18000);
  });
});

describe('Precios', () => {
  const semana = (cambios) => ({ semana: hoy.semana, anio: hoy.anio, ...cambios });

  test('PUT /precios/semana con minorista negativo → 400', async () => {
    rechazo(await llamar('PUT', '/precios/semana', semana({ precioPorKg: -1 })), 'El precio minorista debe ser mayor que 0');
  });

  test('PUT /precios/semana con mayorista 0 → 400', async () => {
    rechazo(await llamar('PUT', '/precios/semana', semana({ precioMayoristaPorKg: 0 })), 'El precio mayorista debe ser mayor que 0');
  });

  test('PUT /precios/semana con litro negativo → 400', async () => {
    rechazo(await llamar('PUT', '/precios/semana', semana({ precioLitro: -1500 })), 'El precio del litro debe ser mayor que 0');
  });

  test('PUT /precios/semana con un precio válido y otro negativo → 400 y no guarda ninguno', async () => {
    rechazo(await llamar('PUT', '/precios/semana', semana({ precioPorKg: 18000, precioLitro: -1 })), 'El precio del litro debe ser mayor que 0');
    assert.equal((await llamar('GET', '/precios')).body.data.length, 0);
  });

  test('PUT /precios/semana sin ningún precio → 400', async () => {
    rechazo(await llamar('PUT', '/precios/semana', semana({})), 'Ingresa el precio del queso o el del litro de leche');
  });

  test('PUT /liquidaciones/precio con litro 0 → 400', async () => {
    rechazo(await llamar('PUT', '/liquidaciones/precio', semana({ precioLitro: 0 })), 'El precio del litro debe ser mayor que 0');
  });

  test('PUT /liquidaciones/precio sin precio → 400 "Falta el precio del litro"', async () => {
    rechazo(await llamar('PUT', '/liquidaciones/precio', semana({})), 'Falta el precio del litro');
  });

  test('PUT /precios/semana válido → 200 (minorista $ 18.000/kg = $ 9.000/lb, litro $ 1.600)', async () => {
    const r = await llamar('PUT', '/precios/semana', semana({ precioPorKg: 18000, precioLitro: 1600 }));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.precioPorLibra, 9000);
    assert.equal(r.body.data.precioLitro, 1600);
  });
});
