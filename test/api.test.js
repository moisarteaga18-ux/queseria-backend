// Prueba de humo de la API (99 casos): cuenta, catálogos, registro de leche, producción y ventas,
// consultas (resumen, reportes, liquidación, merma) y seguridad básica.
// Corre contra una MongoDB temporal en memoria (ver test/ayuda.js), nunca contra la base real.
//
// Datos: todo cae en la última semana YA CERRADA (viernes a jueves), calculada con la fecha de hoy,
// así la prueba da lo mismo cualquier día que se ejecute.
//   Leche: 20 registros de 100..119 L repartidos en los 7 días → 2.190 L; el martes (día 4): 104 + 111 + 118 = 333 L
//   Producción (martes): 10 × (100 L → 10 kg) → 100 kg, rendimiento (10 × 2) ÷ (100 ÷ 20) = 4 lb por lata
//   Ventas (martes): 10 × 2 libras (= 1 kg) a $ 9.000 la libra → $ 18.000 cada una, $ 180.000 y 10 kg en total
//   Stock = 100 − 10 = 90 kg; merma de la semana (sin kg que pasen) = 90 kg
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, diaIso } = require('./ayuda');
const { semanaDeFecha, semanaAnterior, rangoSemana } = require('../src/utils/semana');

const USUARIO = 'prueba_api';
const CLAVE = 'clave123';

const hoy = semanaDeFecha(new Date());
const S = semanaAnterior(hoy.semana, hoy.anio); // última semana cerrada
const VIERNES = rangoSemana(S.semana, S.anio).inicio;
const MARTES = diaIso(VIERNES, 4);

let entorno, api, token, ganaderoId, productoId;
const llamar = (metodo, ruta, cuerpo) => api(metodo, ruta, cuerpo, token);
const suma = (lista, campo) => lista.reduce((s, x) => s + x[campo], 0);

before(async () => {
  entorno = await iniciar();
  api = entorno.api;
});
after(async () => { await entorno.cerrar(); });

describe('Cuenta', () => {
  test('POST /auth/registro crea la cuenta y devuelve un token', async () => {
    const r = await api('POST', '/auth/registro', { username: USUARIO, password: CLAVE });
    assert.equal(r.status, 201);
    assert.ok(r.body.data.token);
    token = r.body.data.token;
  });

  test('POST /auth/login con la clave correcta → 200 y token', async () => {
    const r = await api('POST', '/auth/login', { username: USUARIO, password: CLAVE });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.token);
  });
});

describe('Catálogos', () => {
  test('POST /ganaderos → 201', async () => {
    const r = await llamar('POST', '/ganaderos', { nombre: 'Ganadero A' });
    assert.equal(r.status, 201);
    ganaderoId = r.body.data._id;
  });

  test('POST /productos → 201 con stock 0', async () => {
    const r = await llamar('POST', '/productos', { nombre: 'Queso costeño', stockInicialKg: 0 });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.stockKg, 0);
    productoId = r.body.data._id;
  });
});

describe('Registro de leche (20)', () => {
  for (let i = 0; i < 20; i++) {
    test(`POST /leche n.º ${i + 1}: ${100 + i} L el día ${(i % 7) + 1} de la semana → 201`, async () => {
      const r = await llamar('POST', '/leche', { fecha: diaIso(VIERNES, i % 7), litros: 100 + i, ganaderoId });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.litros, 100 + i);
      assert.equal(r.body.data.nombreGanadero, 'Ganadero A');
    });
  }
});

describe('Producción (10)', () => {
  for (let i = 0; i < 10; i++) {
    test(`POST /produccion n.º ${i + 1}: 100 L → 10 kg, rendimiento 4 lb por lata → 201`, async () => {
      const r = await llamar('POST', '/produccion', { fecha: MARTES, litrosUsados: 100, kgProducidos: 10, productoId });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.rendimiento, 4);
    });
  }
});

describe('Ventas (10)', () => {
  for (let i = 0; i < 10; i++) {
    test(`POST /ventas n.º ${i + 1}: 2 libras a $ 9.000 → 201, total $ 18.000`, async () => {
      const r = await llamar('POST', '/ventas', {
        fecha: MARTES, tipoVenta: 'libras', cantidad: 2, unidad: 'libras', precioUnitario: 9000, productoId
      });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.totalVenta, 18000);
    });
  }
});

describe('Consultas (10 rondas × 5)', () => {
  for (let ronda = 1; ronda <= 10; ronda++) {
    test(`ronda ${ronda}: GET /leche → 20 registros, 2.190 L`, async () => {
      const r = await llamar('GET', '/leche?limit=100');
      assert.equal(r.status, 200);
      assert.equal(r.body.data.length, 20);
      assert.equal(suma(r.body.data, 'litros'), 2190);
    });

    test(`ronda ${ronda}: GET /resumen/hoy del martes → 333 L, 100 kg, 10 ventas, $ 180.000, stock 90 kg`, async () => {
      const r = await llamar('GET', `/resumen/hoy?fecha=${MARTES}`);
      assert.equal(r.status, 200);
      const d = r.body.data;
      assert.equal(d.litrosHoy, 333);
      assert.equal(d.kgProducidosHoy, 100);
      assert.equal(d.numeroVentasHoy, 10);
      assert.equal(d.totalVentasHoy, 180000);
      assert.equal(d.stockActualKg, 90);
    });

    test(`ronda ${ronda}: GET /resumen/semanas → 8 semanas; la cerrada con $ 180.000, 2.190 L, 100 kg, 4 lb/lata`, async () => {
      const r = await llamar('GET', '/resumen/semanas');
      assert.equal(r.status, 200);
      assert.equal(r.body.data.length, 8);
      const s = r.body.data.find(x => x.semana === S.semana && x.anio === S.anio);
      assert.ok(s, 'falta la semana cerrada en el reporte');
      assert.equal(s.ingresos, 180000);
      assert.equal(s.litrosLeche, 2190);
      assert.equal(s.kgProducidos, 100);
      assert.equal(s.librasPorLata, 4);
    });

    test(`ronda ${ronda}: GET /liquidaciones/semana → cerrada, 2.190 L del ganadero, sin precio`, async () => {
      const r = await llamar('GET', `/liquidaciones/semana?semana=${S.semana}&anio=${S.anio}`);
      assert.equal(r.status, 200);
      const d = r.body.data;
      assert.equal(d.cerrada, true);
      assert.equal(d.precioLitro, null);
      assert.equal(d.totalLitros, 2190);
      assert.equal(d.ganaderos.length, 1);
      assert.equal(d.ganaderos[0].litros, 2190);
      assert.equal(d.ganaderos[0].total, null);
    });

    test(`ronda ${ronda}: GET /merma → semana cerrada con merma de 90 kg y pendiente de confirmar`, async () => {
      const r = await llamar('GET', '/merma');
      assert.equal(r.status, 200);
      const s = r.body.data.semanas.find(x => x.semana === S.semana && x.anio === S.anio);
      assert.ok(s, 'falta la semana cerrada en la merma');
      assert.equal(s.kgProducidos, 100);
      assert.equal(s.kgVendidos, 10);
      assert.equal(s.mermaKg, 90);
      assert.equal(r.body.data.pendiente?.semana, S.semana);
    });
  }
});

describe('Seguridad y validación básica', () => {
  test('GET /leche sin token → 401', async () => {
    const r = await api('GET', '/leche', undefined, null);
    assert.equal(r.status, 401);
  });

  test('GET /leche con token falso → 401', async () => {
    const r = await api('GET', '/leche', undefined, 'abc.def.ghi');
    assert.equal(r.status, 401);
  });

  test('POST /leche con 0 litros → 400', async () => {
    const r = await llamar('POST', '/leche', { fecha: diaIso(VIERNES), litros: 0, ganaderoId });
    assert.equal(r.status, 400);
  });

  test('POST /auth/login con objetos {"$gt": ""} (inyección NoSQL) → 400', async () => {
    const r = await api('POST', '/auth/login', { username: { $gt: '' }, password: { $gt: '' } });
    assert.equal(r.status, 400);
  });

  test('11 intentos fallidos de login → el último responde 429', async () => {
    let r;
    for (let i = 0; i < 11; i++) r = await api('POST', '/auth/login', { username: USUARIO, password: 'mala' + i });
    assert.equal(r.status, 429);
  });
});
