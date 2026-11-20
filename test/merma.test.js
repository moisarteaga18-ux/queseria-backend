// Merma y cuenta semanal con la regla del 19 nov 2026 (utils/merma.js):
// - las ventas se descuentan del queso más viejo: lo del viernes es primero de la semana que cerró el jueves
// - ganancia de la semana = ventas del queso de esa semana − leche de esa semana
// - merma = pasado de la anterior + producido − vendido del lote − pasado a la siguiente; % = merma ÷ (pasado + producido)
// - la merma se completa al terminar el viernes siguiente; antes no se inventa
// Fechas fijas: semana 45 de 2026 = vie 30 oct – jue 5 nov; su viernes siguiente es el 6 nov.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { cuentaSemanal, promedioPct } = require('../src/utils/merma');
const { iniciar } = require('./ayuda');

const kg = (fecha, cantidad, precioKg) => ({ fecha, cantidad, unidad: 'kg', totalVenta: cantidad * precioKg });
const lb = (fecha, libras, precioLibra) => ({ fecha, cantidad: libras, unidad: 'libras', totalVenta: libras * precioLibra });
const prod = (fecha, kgProducidos, litrosUsados = 0) => ({ fecha, kgProducidos, litrosUsados });
const semana = (lista, n) => lista.find(s => s.semana === n && s.anio === 2026);

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
  const lista = cuentaSemanal(datos);
  const s45 = semana(lista, 45);
  const s46 = semana(lista, 46);

  test('las ventas del viernes siguiente cuentan para la semana 45', () => {
    assert.equal(s45.kgVendidos, 58);
    assert.equal(s45.kgVendidosViernesSiguiente, 8);
    assert.equal(s45.ventas, 50 * 16000 + 8 * 17000); // $ 936.000
    assert.equal(s46.kgVendidos, 0);
    assert.equal(s46.ventas, 0);
  });

  test('merma = 63 − 58 = 5 kg (7,9 %)', () => {
    assert.equal(s45.completa, true);
    assert.equal(s45.mermaKg, 5);
    assert.equal(s45.mermaPct, 7.9);
    assert.equal(s45.revisar, null);
  });

  test('valor de la merma al precio promedio real de venta (ventas ÷ kg vendidos)', () => {
    assert.equal(s45.precioPromedioKg, Math.round(936000 / 58)); // $ 16.138
    assert.equal(s45.valorMerma, Math.round(5 * Math.round(936000 / 58)));
  });

  test('ganancia = ventas del queso de la semana − leche de la semana (400 L × $ 1.800)', () => {
    assert.equal(s45.costoLeche, 720000);
    assert.equal(s45.ganancia, 936000 - 720000);
  });

  test('la merma no se resta otra vez de la ganancia', () => {
    assert.equal(s45.ganancia, s45.ventas - s45.costoLeche);
  });
});

describe('Antes de que termine el viernes siguiente no hay merma inventada', () => {
  const base = {
    producciones: [prod('2026-10-30', 30), prod('2026-11-03', 33)],
    ventas: [kg('2026-10-31', 20, 16000), kg('2026-11-03', 20, 16000), kg('2026-11-05', 10, 16000)]
  };

  test('el jueves (día de corte): sin merma, con lo que falta por vender', () => {
    const s = semana(cuentaSemanal({ ...base, hoy: '2026-11-05' }), 45);
    assert.equal(s.completa, false);
    assert.equal(s.mermaKg, null);
    assert.equal(s.mermaPct, null);
    assert.equal(s.valorMerma, null);
    assert.equal(s.kgProducidos, 63);
    assert.equal(s.kgVendidos, 50);
    assert.equal(s.kgPorVender, 13);
    assert.equal(s.viernesSiguiente, '2026-11-06');
  });

  test('el viernes siguiente todavía no está completa (se completa al terminar el viernes)', () => {
    const s = semana(cuentaSemanal({ ...base, ventas: [...base.ventas, kg('2026-11-06', 8, 17000)], hoy: '2026-11-06' }), 45);
    assert.equal(s.completa, false);
    assert.equal(s.mermaKg, null);
    assert.equal(s.kgPorVender, 5);
  });

  test('el sábado ya está completa', () => {
    const s = semana(cuentaSemanal({ ...base, hoy: '2026-11-07' }), 45);
    assert.equal(s.completa, true);
    assert.equal(s.mermaKg, 13);
  });
});

describe('Ventas al detal en libras (libra de 500 g)', () => {
  // 40 kg producidos; 30 kg al por mayor + 12 libras (6 kg) al detal en la semana; 4 libras (2 kg) el viernes siguiente
  const lista = cuentaSemanal({
    producciones: [prod('2026-10-31', 40)],
    ventas: [kg('2026-11-02', 30, 16000), lb('2026-11-04', 12, 9000), lb('2026-11-06', 4, 9000)],
    hoy: '2026-11-08'
  });
  const s = semana(lista, 45);

  test('vendido = 30 + 6 + 2 = 38 kg (las libras se pasan a kg ÷ 2)', () => {
    assert.equal(s.kgVendidos, 38);
    assert.equal(s.kgVendidosViernesSiguiente, 2);
    assert.equal(s.ventas, 30 * 16000 + 16 * 9000); // $ 624.000
  });

  test('merma = 40 − 38 = 2 kg (5 %)', () => {
    assert.equal(s.mermaKg, 2);
    assert.equal(s.mermaPct, 5);
  });

  test('precio promedio = $ 624.000 ÷ 38 kg', () => {
    assert.equal(s.precioPromedioKg, Math.round(624000 / 38));
  });
});

describe('Queso pasado a la semana siguiente', () => {
  // Semana 45: 50 kg, 40 vendidos en la semana, 4 el viernes siguiente y 5 pasados a la 46 → merma 1 kg.
  // Semana 46: 5 kg que llegaron + 30 producidos; 32 vendidos; viernes 13 nov vende 2 → merma 1 kg.
  const lista = cuentaSemanal({
    producciones: [prod('2026-10-30', 50), prod('2026-11-07', 30)],
    ventas: [kg('2026-11-02', 40, 16000), kg('2026-11-06', 4, 16000), kg('2026-11-10', 32, 16000), kg('2026-11-13', 2, 16000)],
    traspasos: [{ semana: 45, anio: 2026, kgFinal: 5 }],
    hoy: '2026-11-14'
  });
  const s45 = semana(lista, 45);
  const s46 = semana(lista, 46);

  test('semana 45: merma = 50 − 44 − 5 pasados = 1 kg (2 %)', () => {
    assert.equal(s45.kgPasados, 5);
    assert.equal(s45.kgVendidos, 44);
    assert.equal(s45.mermaKg, 1);
    assert.equal(s45.mermaPct, 2);
  });

  test('semana 46: empieza con los 5 kg; % = merma ÷ (5 + 30)', () => {
    assert.equal(s46.stockInicialKg, 5);
    assert.equal(s46.kgVendidos, 34);
    assert.equal(s46.mermaKg, 1);
    assert.equal(s46.mermaPct, Math.round((1 / 35) * 1000) / 10); // 2,9 %
  });

  test('promedio de las semanas completas = 2 kg ÷ 85 kg', () => {
    assert.equal(promedioPct(lista), Math.round((2 / 85) * 1000) / 10);
  });
});

describe('El viernes se vende primero lo que quedó; si se vende más, el resto es queso nuevo', () => {
  const lista = cuentaSemanal({
    producciones: [prod('2026-10-30', 20), prod('2026-11-06', 30)],
    ventas: [kg('2026-11-03', 15, 16000), kg('2026-11-06', 10, 16000)], // quedaban 5 kg: 5 son de la 45 y 5 de la 46
    hoy: '2026-11-07'
  });

  test('semana 45 vende 15 + 5 = 20 kg y queda sin merma', () => {
    const s = semana(lista, 45);
    assert.equal(s.kgVendidos, 20);
    assert.equal(s.kgVendidosViernesSiguiente, 5);
    assert.equal(s.mermaKg, 0);
  });

  test('semana 46 recibe los otros 5 kg', () => {
    assert.equal(semana(lista, 46).kgVendidos, 5);
  });
});

describe('Avisos de "revisar" y valor sin ventas', () => {
  test('merma de más del 15 % → revisar', () => {
    const s = semana(cuentaSemanal({ producciones: [prod('2026-10-30', 50)], ventas: [kg('2026-11-02', 40, 16000)], hoy: '2026-11-07' }), 45);
    assert.equal(s.mermaPct, 20);
    assert.match(s.revisar, /15 %/);
  });

  test('merma negativa (se vendió más de lo registrado) → revisar y valor 0', () => {
    const s = semana(cuentaSemanal({ producciones: [prod('2026-10-30', 10)], ventas: [kg('2026-11-02', 12, 16000)], hoy: '2026-11-07' }), 45);
    assert.equal(s.mermaKg, -2);
    assert.match(s.revisar, /negativa/);
    assert.equal(s.valorMerma, 0);
  });

  test('sin ventas, la merma se valora con el precio por kilo registrado para esa semana', () => {
    const s = semana(cuentaSemanal({
      producciones: [prod('2026-10-30', 10)],
      precios: [{ semana: 45, anio: 2026, fechaInicio: '2026-10-30T00:00:00.000Z', fechaFin: '2026-11-05T23:59:59.999Z', precioPorKg: 18000 }],
      hoy: '2026-11-07'
    }), 45);
    assert.equal(s.precioPromedioKg, null);
    assert.equal(s.precioMermaKg, 18000);
    assert.equal(s.valorMerma, 10 * 18000);
  });
});

describe('API: consultar no escribe y "pasar queso" es una acción aparte', () => {
  let entorno, token;
  const llamar = (m, r, c) => entorno.api(m, r, c, token);
  before(async () => {
    entorno = await iniciar();
    token = await entorno.crearUsuario('prueba_merma');
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

  test('GET /merma ya no trae la pregunta del viernes ("pendiente")', async () => {
    const r = await llamar('GET', '/merma?fecha=2026-11-07');
    assert.equal(r.body.data.pendiente, undefined);
  });

  test('pasar 5 kg de la semana 45 → merma 50 − 40 − 5 = 5 kg', async () => {
    const r = await llamar('PUT', '/merma/2026/45', { kgFinal: 5, fecha: '2026-11-07' });
    assert.equal(r.status, 200);
    const s = r.body.data.semanas.find(x => x.semana === 45);
    assert.equal(s.kgPasados, 5);
    assert.equal(s.mermaKg, 5);
    assert.equal(r.body.data.semanas.find(x => x.semana === 46).stockInicialKg, 5);
  });

  test('pasar 0 kg deshace el traspaso', async () => {
    const r = await llamar('PUT', '/merma/2026/45', { kgFinal: 0, fecha: '2026-11-07' });
    assert.equal(r.body.data.semanas.find(x => x.semana === 45).mermaKg, 10);
  });

  test('no se puede pasar queso de una semana que no ha cerrado, ni kg negativos', async () => {
    const abierta = await llamar('PUT', '/merma/2026/45', { kgFinal: 3, fecha: '2026-11-04' });
    assert.equal(abierta.status, 400);
    assert.match(abierta.body.error, /no ha cerrado/);
    const negativa = await llamar('PUT', '/merma/2026/45', { kgFinal: -1, fecha: '2026-11-07' });
    assert.equal(negativa.status, 400);
  });

  test('GET /resumen/ganancias de la semana 45: ganancia por lote y merma completa', async () => {
    const r = await llamar('GET', '/resumen/ganancias?fecha=2026-11-07&semana=45&anio=2026');
    const s = r.body.data.semanaActual;
    assert.equal(s.semana, 45);
    assert.equal(s.ingresos, 640000);
    assert.equal(s.completa, true);
    assert.equal(s.mermaKg, 10);
    assert.equal(s.mermaPct, 20);
    assert.ok(s.revisar);
  });
});
