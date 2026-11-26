// Merma y cuenta semanal (utils/merma.js):
// - las ventas se descuentan del queso más viejo: lo del viernes es primero de la semana que cerró el jueves
// - ganancia de la semana = ventas del queso de esa semana − leche de esa semana
// - MERMA MANUAL (25 nov 2026): la app ya no la calcula. Muestra lo que sobró (pasado + producido − vendido)
//   y lo sugiere (menos lo pasado a la siguiente); la merma es la que registra el usuario. Sin registrar:
//   "pendiente por registrar" (null). merma + pasado ≤ sobrante. % = merma ÷ (pasado + producido);
//   valor = merma × precio promedio real de venta.
// Fechas fijas: semana 45 de 2026 = vie 30 oct – jue 5 nov; su viernes siguiente es el 6 nov.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { cuentaSemanal, promedioPct } = require('../src/utils/merma');
const { iniciar } = require('./ayuda');

const kg = (fecha, cantidad, precioKg) => ({ fecha, cantidad, unidad: 'kg', totalVenta: cantidad * precioKg });
const lb = (fecha, libras, precioLibra) => ({ fecha, cantidad: libras, unidad: 'libras', totalVenta: libras * precioLibra });
const prod = (fecha, kgProducidos, litrosUsados = 0) => ({ fecha, kgProducidos, litrosUsados });
const semana = (lista, n) => lista.find(s => s.semana === n && s.anio === 2026);
const registrada = (n, mermaRegistradaKg, kgFinal = 0) => ({ semana: n, anio: 2026, kgFinal, mermaRegistradaKg });

describe('Ejemplo del usuario: 63 kg, 50 kg vendidos de viernes a jueves y 8 kg el viernes siguiente', () => {
  const datos = {
    producciones: [prod('2026-10-30', 30), prod('2026-11-03', 33), prod('2026-11-06', 30)], // la última es de la semana 46
    ventas: [
      kg('2026-10-31', 20, 16000), kg('2026-11-03', 20, 16000), kg('2026-11-05', 10, 16000), // 50 kg en la semana
      kg('2026-11-06', 8, 17000) // viernes siguiente: queso que quedó de la semana 45
    ],
    leches: [{ fecha: '2026-11-02', litros: 400 }],
    preciosLitro: [{ semana: 45, anio: 2026, precioLitro: 1800 }],
    hoy: '2026-11-07' // sábado: ya terminó el viernes siguiente
  };
  const sinRegistrar = semana(cuentaSemanal(datos), 45);
  const lista = cuentaSemanal({ ...datos, traspasos: [registrada(45, 5)] });
  const s45 = semana(lista, 45);
  const s46 = semana(lista, 46);

  test('las ventas del viernes siguiente cuentan para la semana 45', () => {
    assert.equal(s45.kgVendidos, 58);
    assert.equal(s45.kgVendidosViernesSiguiente, 8);
    assert.equal(s45.ventas, 50 * 16000 + 8 * 17000); // $ 936.000
    assert.equal(s46.kgVendidos, 0);
    assert.equal(s46.ventas, 0);
  });

  test('sin registrar: sobraron 63 − 58 = 5 kg (sugerida 5 kg) y la merma queda pendiente, sin número', () => {
    assert.equal(sinRegistrar.sobranteKg, 5);
    assert.equal(sinRegistrar.mermaSugeridaKg, 5);
    assert.equal(sinRegistrar.mermaKg, null);
    assert.equal(sinRegistrar.mermaPct, null);
    assert.equal(sinRegistrar.valorMerma, null);
    assert.equal(sinRegistrar.mermaPendiente, true);
  });

  test('registrada 5 kg → 7,9 % y ya no está pendiente', () => {
    assert.equal(s45.mermaKg, 5);
    assert.equal(s45.mermaPct, 7.9);
    assert.equal(s45.mermaPendiente, false);
    assert.equal(s45.revisar, null);
  });

  test('valor de la merma = 5 kg × precio promedio real de venta ($ 936.000 ÷ 58 kg = $ 16.138)', () => {
    assert.equal(s45.precioPromedioKg, 16138);
    assert.equal(s45.valorMerma, 5 * 16138); // $ 80.690
  });

  test('el usuario puede registrar otro número (3 kg): 3 ÷ 63 = 4,8 % y $ 48.414', () => {
    const s = semana(cuentaSemanal({ ...datos, traspasos: [registrada(45, 3)] }), 45);
    assert.equal(s.mermaKg, 3);
    assert.equal(s.mermaPct, 4.8);
    assert.equal(s.valorMerma, 3 * 16138);
  });

  test('ganancia = ventas del queso de la semana − leche de la semana (400 L × $ 1.800)', () => {
    assert.equal(s45.costoLeche, 720000);
    assert.equal(s45.ganancia, 936000 - 720000);
  });

  test('la merma no se resta otra vez de la ganancia (igual registrada o no)', () => {
    assert.equal(s45.ganancia, s45.ventas - s45.costoLeche);
    assert.equal(sinRegistrar.ganancia, s45.ganancia);
  });
});

describe('Cuándo se puede registrar: desde el viernes siguiente', () => {
  const base = {
    producciones: [prod('2026-10-30', 30), prod('2026-11-03', 33)],
    ventas: [kg('2026-10-31', 20, 16000), kg('2026-11-03', 20, 16000), kg('2026-11-05', 10, 16000)]
  };

  test('el jueves (día de corte): la semana no ha cerrado, sin merma ni pendiente, con lo que falta por vender', () => {
    const s = semana(cuentaSemanal({ ...base, hoy: '2026-11-05' }), 45);
    assert.equal(s.cerrada, false);
    assert.equal(s.mermaPendiente, false);
    assert.equal(s.sobranteKg, null);
    assert.equal(s.mermaKg, null);
    assert.equal(s.kgProducidos, 63);
    assert.equal(s.kgVendidos, 50);
    assert.equal(s.kgPorVender, 13);
    assert.equal(s.viernesSiguiente, '2026-11-06');
  });

  test('el viernes siguiente ya cerró: sobrante 63 − 50 − 8 = 5 kg y "pendiente por registrar"', () => {
    const s = semana(cuentaSemanal({ ...base, ventas: [...base.ventas, kg('2026-11-06', 8, 17000)], hoy: '2026-11-06' }), 45);
    assert.equal(s.cerrada, true);
    assert.equal(s.completa, false);
    assert.equal(s.sobranteKg, 5);
    assert.equal(s.mermaPendiente, true);
    assert.equal(s.mermaKg, null);
  });

  test('una semana sin queso (nada producido ni pasado) no queda pendiente', () => {
    // Semana 45 produce y vende todo; la 46 (cerrada el 13 nov) no tiene queso
    const s = semana(cuentaSemanal({ producciones: [prod('2026-10-30', 10)], ventas: [kg('2026-11-02', 10, 16000)], hoy: '2026-11-14' }), 46);
    assert.equal(s.cerrada, true);
    assert.equal(s.mermaPendiente, false);
    assert.equal(s.mermaKg, null);
  });
});

describe('Ventas al detal en libras (libra de 500 g)', () => {
  // 40 kg producidos; 30 kg al por mayor + 12 libras (6 kg) al detal en la semana; 4 libras (2 kg) el viernes siguiente
  const lista = cuentaSemanal({
    producciones: [prod('2026-10-31', 40)],
    ventas: [kg('2026-11-02', 30, 16000), lb('2026-11-04', 12, 9000), lb('2026-11-06', 4, 9000)],
    traspasos: [registrada(45, 2)],
    hoy: '2026-11-08'
  });
  const s = semana(lista, 45);

  test('vendido = 30 + 6 + 2 = 38 kg (las libras se pasan a kg ÷ 2)', () => {
    assert.equal(s.kgVendidos, 38);
    assert.equal(s.kgVendidosViernesSiguiente, 2);
    assert.equal(s.ventas, 30 * 16000 + 16 * 9000); // $ 624.000
  });

  test('sobraron 40 − 38 = 2 kg; registrada 2 kg = 5 %', () => {
    assert.equal(s.sobranteKg, 2);
    assert.equal(s.mermaKg, 2);
    assert.equal(s.mermaPct, 5);
  });

  test('precio promedio = $ 624.000 ÷ 38 kg = $ 16.421; valor = 2 × $ 16.421', () => {
    assert.equal(s.precioPromedioKg, 16421);
    assert.equal(s.valorMerma, 2 * 16421);
  });
});

describe('Queso pasado a la semana siguiente', () => {
  // Semana 45: 50 kg, 40 vendidos en la semana, 4 el viernes siguiente; sobran 6, pasa 5 → sugerida 1 kg.
  // Semana 46: 5 kg que llegaron + 30 producidos; 32 vendidos; viernes 13 nov vende 2 → sobra 1 kg.
  const lista = cuentaSemanal({
    producciones: [prod('2026-10-30', 50), prod('2026-11-07', 30)],
    ventas: [kg('2026-11-02', 40, 16000), kg('2026-11-06', 4, 16000), kg('2026-11-10', 32, 16000), kg('2026-11-13', 2, 16000)],
    traspasos: [registrada(45, 1, 5), registrada(46, 1)],
    hoy: '2026-11-14'
  });
  const s45 = semana(lista, 45);
  const s46 = semana(lista, 46);

  test('semana 45: sobraron 50 − 44 = 6 kg; pasados 5 → sugerida 1 kg; registrada 1 kg (2 %)', () => {
    assert.equal(s45.kgPasados, 5);
    assert.equal(s45.kgVendidos, 44);
    assert.equal(s45.sobranteKg, 6);
    assert.equal(s45.mermaSugeridaKg, 1);
    assert.equal(s45.mermaKg, 1);
    assert.equal(s45.mermaPct, 2);
  });

  test('semana 46: empieza con los 5 kg; % = merma ÷ (5 + 30)', () => {
    assert.equal(s46.stockInicialKg, 5);
    assert.equal(s46.kgVendidos, 34);
    assert.equal(s46.sobranteKg, 1);
    assert.equal(s46.mermaKg, 1);
    assert.equal(s46.mermaPct, Math.round((1 / 35) * 1000) / 10); // 2,9 %
  });

  test('promedio de las semanas con merma registrada = 2 kg ÷ 85 kg = 2,4 %', () => {
    assert.equal(promedioPct(lista), 2.4);
  });

  test('una semana sin registrar no entra en el promedio', () => {
    const otra = cuentaSemanal({
      producciones: [prod('2026-10-30', 50), prod('2026-11-07', 30)],
      ventas: [kg('2026-11-02', 40, 16000), kg('2026-11-06', 4, 16000), kg('2026-11-10', 32, 16000), kg('2026-11-13', 2, 16000)],
      traspasos: [registrada(45, 1, 5)],
      hoy: '2026-11-14'
    });
    assert.equal(promedioPct(otra), 2); // 1 kg ÷ 50 kg
  });
});

describe('El viernes se vende primero lo que quedó; si se vende más, el resto es queso nuevo', () => {
  const lista = cuentaSemanal({
    producciones: [prod('2026-10-30', 20), prod('2026-11-06', 30)],
    ventas: [kg('2026-11-03', 15, 16000), kg('2026-11-06', 10, 16000)], // quedaban 5 kg: 5 son de la 45 y 5 de la 46
    hoy: '2026-11-07'
  });

  test('semana 45 vende 15 + 5 = 20 kg y no sobra nada (sugerida 0 kg)', () => {
    const s = semana(lista, 45);
    assert.equal(s.kgVendidos, 20);
    assert.equal(s.kgVendidosViernesSiguiente, 5);
    assert.equal(s.sobranteKg, 0);
    assert.equal(s.mermaSugeridaKg, 0);
  });

  test('semana 46 recibe los otros 5 kg', () => {
    assert.equal(semana(lista, 46).kgVendidos, 5);
  });
});

describe('Avisos de "revisar" y valor sin ventas', () => {
  test('merma registrada de más del 15 % → revisar', () => {
    const s = semana(cuentaSemanal({ producciones: [prod('2026-10-30', 50)], ventas: [kg('2026-11-02', 40, 16000)], traspasos: [registrada(45, 10)], hoy: '2026-11-07' }), 45);
    assert.equal(s.mermaPct, 20);
    assert.match(s.revisar, /15 %/);
  });

  test('se vendió más de lo registrado (sobrante negativo) → revisar', () => {
    const s = semana(cuentaSemanal({ producciones: [prod('2026-10-30', 10)], ventas: [kg('2026-11-02', 12, 16000)], hoy: '2026-11-07' }), 45);
    assert.equal(s.sobranteKg, -2);
    assert.equal(s.mermaSugeridaKg, 0);
    assert.match(s.revisar, /más queso/);
  });

  test('ventas tardías: merma 6 kg registrada y después se venden 3 kg más → ya no cabe, revisar', () => {
    const s = semana(cuentaSemanal({
      producciones: [prod('2026-10-30', 50)],
      ventas: [kg('2026-11-02', 44, 16000), kg('2026-11-04', 3, 16000)],
      traspasos: [registrada(45, 6)],
      hoy: '2026-11-08'
    }), 45);
    assert.equal(s.sobranteKg, 3);
    assert.match(s.revisar, /Corrige la merma/);
  });

  test('sin ventas, la merma se valora con el precio por kilo registrado para esa semana', () => {
    const s = semana(cuentaSemanal({
      producciones: [prod('2026-10-30', 10)],
      precios: [{ semana: 45, anio: 2026, fechaInicio: '2026-10-30T00:00:00.000Z', fechaFin: '2026-11-05T23:59:59.999Z', precioPorKg: 18000 }],
      traspasos: [registrada(45, 10)],
      hoy: '2026-11-07'
    }), 45);
    assert.equal(s.precioPromedioKg, null);
    assert.equal(s.precioMermaKg, 18000);
    assert.equal(s.valorMerma, 10 * 18000);
  });
});

describe('API: registrar, corregir y quitar la merma; pasar queso', () => {
  let entorno, token;
  const llamar = (m, r, c) => entorno.api(m, r, c, token);
  const s45 = (r) => r.body.data.semanas.find(x => x.semana === 45);
  before(async () => {
    entorno = await iniciar();
    token = await entorno.crearUsuario('prueba_merma');
    // Semana 45: 50 kg producidos, 40 vendidos → sobran 10 kg
    await llamar('POST', '/produccion', { fecha: '2026-10-30', litrosUsados: 500, kgProducidos: 50 });
    await llamar('POST', '/ventas', { fecha: '2026-11-02', tipoVenta: 'mayorista', cantidad: 40, unidad: 'kg', precioUnitario: 16000 });
  });
  after(async () => { await entorno.cerrar(); });

  test('GET /merma y GET /resumen/ganancias no guardan nada en cierres_semana', async () => {
    const { CierreSemana } = require('../src/models');
    await llamar('GET', '/merma?fecha=2026-11-07');
    await llamar('GET', '/resumen/ganancias?fecha=2026-11-07');
    assert.equal(await CierreSemana.countDocuments(), 0);
  });

  test('sin registrar: sobraron 10 kg (sugerida) y "pendiente por registrar"', async () => {
    const s = s45(await llamar('GET', '/merma?fecha=2026-11-07'));
    assert.equal(s.sobranteKg, 10);
    assert.equal(s.mermaSugeridaKg, 10);
    assert.equal(s.mermaKg, null);
    assert.equal(s.mermaPendiente, true);
  });

  test('no se registra merma de una semana abierta, ni negativa, ni de más de lo que sobró', async () => {
    const abierta = await llamar('PUT', '/merma/2026/45/merma', { kg: 2, fecha: '2026-11-04' });
    assert.equal(abierta.status, 400);
    assert.match(abierta.body.error, /no ha cerrado/);
    assert.equal((await llamar('PUT', '/merma/2026/45/merma', { kg: -1, fecha: '2026-11-07' })).status, 400);
    assert.equal((await llamar('PUT', '/merma/2026/45/merma', { fecha: '2026-11-07' })).status, 400);
    const demas = await llamar('PUT', '/merma/2026/45/merma', { kg: 11, fecha: '2026-11-07' });
    assert.equal(demas.status, 400);
    assert.match(demas.body.error, /hasta 10 kg/);
  });

  test('registrar 4 kg → 8 %, valor 4 × $ 16.000 = $ 64.000; anterior = null', async () => {
    const r = await llamar('PUT', '/merma/2026/45/merma', { kg: 4, fecha: '2026-11-07' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.anterior, null);
    const s = s45(r);
    assert.equal(s.mermaKg, 4);
    assert.equal(s.mermaPct, 8);
    assert.equal(s.valorMerma, 64000);
    assert.equal(s.mermaPendiente, false);
  });

  test('pasar queso: con 4 kg de merma se pueden pasar hasta 6 kg (7 → 400)', async () => {
    const demas = await llamar('PUT', '/merma/2026/45', { kgFinal: 7, fecha: '2026-11-07' });
    assert.equal(demas.status, 400);
    assert.match(demas.body.error, /hasta 6 kg/);
    const r = await llamar('PUT', '/merma/2026/45', { kgFinal: 6, fecha: '2026-11-07' });
    assert.equal(r.status, 200);
    assert.equal(s45(r).kgPasados, 6);
    assert.equal(s45(r).mermaSugeridaKg, 4);
    assert.equal(r.body.data.semanas.find(x => x.semana === 46).stockInicialKg, 6);
  });

  test('corregir la merma con 6 kg pasados: hasta 4 kg (5 → 400); 3 kg → 200 y anterior = 4', async () => {
    const demas = await llamar('PUT', '/merma/2026/45/merma', { kg: 5, fecha: '2026-11-07' });
    assert.equal(demas.status, 400);
    assert.match(demas.body.error, /pasaste 6 kg/);
    const r = await llamar('PUT', '/merma/2026/45/merma', { kg: 3, fecha: '2026-11-07' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.anterior, 4);
    assert.equal(s45(r).mermaKg, 3);
  });

  test('GET /resumen/ganancias y /resumen/semanas traen la merma registrada', async () => {
    const g = (await llamar('GET', '/resumen/ganancias?fecha=2026-11-07&semana=45&anio=2026')).body.data.semanaActual;
    assert.equal(g.ingresos, 640000);
    assert.equal(g.mermaKg, 3);
    assert.equal(g.mermaPct, 6);
    const lista = (await llamar('GET', '/resumen/semanas?n=2&fecha=2026-11-07&hasta=2026-11-07')).body.data;
    const s = lista.find(x => x.semana === 45);
    assert.equal(s.mermaKg, 3);
    assert.equal(s.mermaPendiente, false);
    assert.equal(s.valorMerma, 48000);
  });

  test('quitar la merma → vuelve a "pendiente"; anterior = 3 (para Deshacer); otra vez → 404', async () => {
    const r = await llamar('DELETE', '/merma/2026/45/merma?fecha=2026-11-07');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.anterior, 3);
    assert.equal(s45(r).mermaKg, null);
    assert.equal(s45(r).mermaPendiente, true);
    assert.equal((await llamar('DELETE', '/merma/2026/45/merma?fecha=2026-11-07')).status, 404);
  });

  test('el campo viejo mermaKg de un cierre anterior se ignora (no aparece como merma)', async () => {
    const { CierreSemana } = require('../src/models');
    await CierreSemana.collection.updateOne({ semana: 45, anio: 2026 }, { $set: { mermaKg: 9.5, mermaPct: 19 } });
    const s = s45(await llamar('GET', '/merma?fecha=2026-11-07'));
    assert.equal(s.mermaKg, null);
    assert.equal(s.mermaPendiente, true);
  });

  test('una semana sin queso no deja registrar merma', async () => {
    const r = await llamar('PUT', '/merma/2026/40/merma', { kg: 0, fecha: '2026-11-07' });
    assert.equal(r.status, 400);
  });
});
