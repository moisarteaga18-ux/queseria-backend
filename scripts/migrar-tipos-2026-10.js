// Corrige los registros existentes (octubre 2026). Por defecto SOLO muestra lo que haría.
//
//   node scripts/migrar-tipos-2026-10.js              (simulación)
//   node scripts/migrar-tipos-2026-10.js --aplicar    (respaldo + cambios)
//
// 1. Campos decimales guardados como int/long/texto → double (Atlas los mostraba con tipo mixto).
// 2. Rendimiento de producción = libras por lata = (kg × 2) ÷ (litros ÷ 20) (antes era litros ÷ kg).
// 3. Informa si hay ventas en libras: con la libra de 500 g su conversión a kg cambia (no las toca).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { librasPorLata } = require('../src/utils/unidades');
const { carpetaRespaldos } = require('./respaldar');

const APLICAR = process.argv.includes('--aplicar');
const NO_DOUBLE = { $in: ['int', 'long', 'decimal', 'string'] };

// Campos de primer nivel por colección
const CAMPOS = {
  leches: ['litros'],
  produccions: ['litrosUsados', 'kgProducidos', 'rendimiento'],
  precios: ['precioPorKg'],
  ventas: ['cantidad', 'precioUnitario', 'totalVenta'],
  productos: ['precioPorKg', 'stockKg', 'stockMinimoKg'],
  movimientos: ['cantidadKg'],
  precioleches: ['precioLitro'],
  descuentos: ['valor', 'litros'],
  liquidaciones: ['litros', 'precioLitro', 'subtotal', 'totalDescuentos', 'total', 'totalPagado'],
  cierres_semana: ['stockInicialKg', 'kgProducidos', 'kgVendidos', 'kgFinal', 'mermaKg', 'mermaPct', 'precioPorKg', 'valorMerma']
};
// Campos dentro de listas: liquidaciones.dias[].litros, liquidaciones.descuentos[].litros/valor
const EN_LISTAS = { dias: ['litros'], descuentos: ['litros', 'valor'] };

const aDouble = (campo) => ({ $convert: { input: '$' + campo, to: 'double', onError: '$' + campo, onNull: '$' + campo } });

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const col = (n) => db.collection(n);
  console.log(`Base: ${db.databaseName} · modo: ${APLICAR ? 'APLICAR' : 'simulación (no cambia nada)'}\n`);

  // ── 1. Tipos ──
  console.log('1) Campos decimales que no están como double');
  const cambios = []; // { coleccion, filtro, update }
  const respaldo = { fecha: new Date().toISOString() };
  for (const [c, campos] of Object.entries(CAMPOS)) {
    for (const f of campos) {
      const filtro = { $expr: { $in: [{ $type: '$' + f }, NO_DOUBLE.$in] } };
      const docs = await col(c).find(filtro).toArray();
      if (!docs.length) continue;
      const tipos = [...new Set(docs.map(d => typeof d[f] === 'string' ? 'texto' : 'entero'))].join('/');
      console.log(`   ${c}.${f}: ${docs.length} (${tipos})`);
      (respaldo[c] ||= new Map());
      for (const d of docs) respaldo[c].set(String(d._id), d);
      cambios.push({ c, filtro, update: [{ $set: { [f]: aDouble(f) } }] });
    }
  }
  for (const [lista, campos] of Object.entries(EN_LISTAS)) {
    const condicion = { $anyElementTrue: [{ $map: { input: { $ifNull: ['$' + lista, []] }, as: 'x',
      in: { $or: campos.map(f => ({ $in: [{ $type: '$$x.' + f }, NO_DOUBLE.$in] })) } } }] };
    const docs = await col('liquidaciones').find({ $expr: condicion }).toArray();
    if (!docs.length) continue;
    console.log(`   liquidaciones.${lista}[].${campos.join('/')}: ${docs.length} liquidaciones`);
    (respaldo.liquidaciones ||= new Map());
    for (const d of docs) respaldo.liquidaciones.set(String(d._id), d);
    cambios.push({ c: 'liquidaciones', filtro: { $expr: condicion }, update: [{ $set: { [lista]: { $map: {
      input: '$' + lista, as: 'x',
      in: { $mergeObjects: ['$$x', Object.fromEntries(campos.map(f => [f, { $cond: [{ $eq: [{ $type: '$$x.' + f }, 'missing'] }, '$$REMOVE',
        { $convert: { input: '$$x.' + f, to: 'double', onError: '$$x.' + f, onNull: '$$x.' + f } }] }]))] }
    } } } }] });
  }
  if (!cambios.length) console.log('   ninguno');

  // ── 2. Rendimiento ──
  console.log('\n2) Rendimiento de producción → libras por lata');
  const producciones = await col('produccions').find().toArray();
  const rendimientos = [];
  for (const p of producciones) {
    const nuevo = librasPorLata(Number(p.kgProducidos), Number(p.litrosUsados));
    if (Number(p.rendimiento) !== nuevo) {
      rendimientos.push({ _id: p._id, nuevo });
      console.log(`   ${p.fecha.toISOString().slice(0, 10)} ${p.litrosUsados} L → ${p.kgProducidos} kg: ${p.rendimiento} → ${nuevo} lb/lata`);
      (respaldo.produccions ||= new Map()).set(String(p._id), p);
    }
  }
  if (!rendimientos.length) console.log('   todos al día');

  // ── 3. Datos en libras (solo informe) ──
  const enLibras = await col('ventas').find({ unidad: 'libras' }).toArray();
  console.log(`\n3) Ventas registradas en libras: ${enLibras.length}`);
  for (const v of enLibras) {
    console.log(`   ${v.fecha.toISOString().slice(0, 10)} ${v.cantidad} lb: antes ${(v.cantidad / 2.2046).toFixed(2)} kg, ahora ${(v.cantidad / 2).toFixed(2)} kg`);
  }
  if (enLibras.length) console.log('   (no se modifican: el inventario de esas ventas se descontó con la libra de 453,6 g)');

  if (!APLICAR) {
    console.log('\nSimulación terminada: no se cambió nada. Para aplicar: --aplicar');
    return mongoose.disconnect();
  }

  const archivo = path.join(carpetaRespaldos(), `antes-de-migrar-tipos-${respaldo.fecha.slice(0, 10)}.json`);
  const { EJSON } = require('bson');
  fs.writeFileSync(archivo, EJSON.stringify(Object.fromEntries(Object.entries(respaldo)
    .map(([k, v]) => [k, v instanceof Map ? [...v.values()] : v])), null, 1, { relaxed: false }));
  console.log(`\nRespaldo guardado en ${archivo}`);
  let n = 0;
  for (const x of cambios) n += (await col(x.c).updateMany(x.filtro, x.update)).modifiedCount;
  for (const r of rendimientos) await col('produccions').updateOne({ _id: r._id }, { $set: { rendimiento: r.nuevo } });
  // Por si quedó un rendimiento entero tras recalcularlo
  await col('produccions').updateMany({ rendimiento: { $type: 'int' } }, [{ $set: { rendimiento: aDouble('rendimiento') } }]);
  console.log(`Tipos corregidos en ${n} actualizaciones; ${rendimientos.length} rendimientos recalculados.\nMigración aplicada.`);
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
