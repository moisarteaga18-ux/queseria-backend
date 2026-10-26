// Limpieza de la base (octubre 2026). Por defecto SOLO muestra lo que haría; con --aplicar lo hace,
// después de guardar un respaldo JSON de todo lo que toca.
//
//   node scripts/migrar-limpieza-2026-10.js              (simulación)
//   node scripts/migrar-limpieza-2026-10.js --aplicar    (respaldo + cambios)
//
// Usa MONGODB_URI (variable de entorno o .env). Pasos:
//  1. `pagos`: colección vieja (la reemplazó `liquidaciones`); se elimina solo si está vacía.
//     `descuentos` NO se toca: la usan las liquidaciones (adelantos, préstamos, leche rechazada).
//  2. Costo del litro: `precios.costoLitroLeche` → `precioleches.precioLitro` (único lugar).
//     Si la semana ya tiene precio en precioleches, se conserva ese (es el que usan las liquidaciones).
//     Después se quita `costoLitroLeche` de todos los precios.
//  3. Leche con solo `proveedor` (sin ganaderoId): se asigna al ganadero del mismo nombre
//     (sin tildes ni mayúsculas); si no existe, se crea el ganadero. Si el nombre coincide con dos
//     ganaderos, el registro no se toca y se informa. Después se quita `proveedor` de los registros
//     que ya tienen ganadero.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { semanaDeFecha } = require('../src/utils/semana');

const APLICAR = process.argv.includes('--aplicar');
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const log = (...a) => console.log(...a);

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const col = (n) => db.collection(n);
  const existe = async (n) => (await db.listCollections({ name: n }).toArray()).length > 0;
  log(`Base: ${db.databaseName} · modo: ${APLICAR ? 'APLICAR' : 'simulación (no cambia nada)'}\n`);

  // ── Respaldo de todo lo que se va a tocar ──
  const respaldo = {
    fecha: new Date().toISOString(),
    pagos: (await existe('pagos')) ? await col('pagos').find().toArray() : [],
    precios: await col('precios').find({ costoLitroLeche: { $exists: true } }).toArray(),
    precioleches: await col('precioleches').find().toArray(),
    leches: await col('leches').find({ proveedor: { $exists: true } }).toArray(),
    ganaderos: await col('ganaderos').find().toArray()
  };

  // ── 1. pagos y descuentos ──
  const nPagos = respaldo.pagos.length;
  const nDescuentos = (await existe('descuentos')) ? await col('descuentos').countDocuments() : 0;
  log('1) Colecciones viejas');
  if (!(await existe('pagos'))) log('   pagos: no existe (nada que hacer)');
  else if (nPagos === 0) log('   pagos: vacía → se elimina');
  else log(`   pagos: tiene ${nPagos} documentos → NO se elimina (revisar a mano)`);
  log(`   descuentos: ${nDescuentos} documentos → se conserva (la usan las liquidaciones)`);

  // ── 2. costo del litro ──
  log('\n2) Costo del litro de leche → precioleches');
  const conCosto = respaldo.precios.filter(p => p.costoLitroLeche > 0)
    .sort((a, b) => b.createdAt - a.createdAt); // el más reciente de cada semana primero
  const precioLecheDe = new Map(respaldo.precioleches.map(p => [`${p.usuarioId}-${p.anio}-${p.semana}`, p]));
  const nuevos = new Map();
  const conflictos = [];
  for (const p of conCosto) {
    const k = `${p.usuarioId}-${p.anio}-${p.semana}`;
    const actual = precioLecheDe.get(k);
    if (actual) {
      if (actual.precioLitro !== p.costoLitroLeche) conflictos.push({ semana: p.semana, anio: p.anio, precios: p.costoLitroLeche, precioleches: actual.precioLitro });
      continue;
    }
    if (!nuevos.has(k)) nuevos.set(k, { usuarioId: p.usuarioId, semana: p.semana, anio: p.anio, precioLitro: p.costoLitroLeche });
  }
  log(`   precios con costoLitroLeche: ${respaldo.precios.length} (${conCosto.length} con valor > 0)`);
  for (const n of nuevos.values()) log(`   + semana ${n.semana}/${n.anio}: precio del litro ${n.precioLitro} (se crea en precioleches)`);
  for (const c of conflictos) log(`   ! semana ${c.semana}/${c.anio}: precios decía ${c.precios}, precioleches dice ${c.precioleches} → se conserva ${c.precioleches}`);
  log(`   Se quita costoLitroLeche de ${respaldo.precios.length} precios`);

  // ── 3. leche: proveedor → ganaderoId ──
  log('\n3) Leche: proveedor → ganadero');
  const sinGanadero = respaldo.leches.filter(l => !l.ganaderoId);
  const ganaderosDe = new Map(); // usuarioId → Map(nombre normalizado → [ganaderos])
  for (const g of respaldo.ganaderos) {
    const u = String(g.usuarioId);
    if (!ganaderosDe.has(u)) ganaderosDe.set(u, new Map());
    const m = ganaderosDe.get(u);
    const n = normalizar(g.nombre);
    m.set(n, [...(m.get(n) || []), g]);
  }
  const asignar = [];   // { leche, ganaderoId | null (crear), nombre }
  const ambiguos = [];
  const porCrear = new Map(); // `${usuario}-${nombre}` → nombre original
  for (const l of sinGanadero) {
    const u = String(l.usuarioId);
    const nombre = (l.proveedor || '').trim() || 'Principal';
    const coincide = ganaderosDe.get(u)?.get(normalizar(nombre)) || [];
    if (coincide.length > 1) { ambiguos.push(l); continue; }
    const clave = `${u}-${normalizar(nombre)}`;
    if (coincide.length === 0 && !porCrear.has(clave)) porCrear.set(clave, { usuarioId: l.usuarioId, nombre });
    asignar.push({ leche: l, ganaderoId: coincide[0]?._id ?? null, clave, nombre: coincide[0]?.nombre ?? porCrear.get(clave).nombre });
  }
  log(`   registros con proveedor: ${respaldo.leches.length}; sin ganadero: ${sinGanadero.length}`);
  for (const a of asignar) {
    log(`   ${a.leche.fecha.toISOString().slice(0, 10)} ${a.leche.litros} L "${a.leche.proveedor}" → ${a.ganaderoId ? 'ganadero existente' : 'ganadero NUEVO'} "${a.nombre}"`);
  }
  for (const c of porCrear.values()) log(`   + se crea el ganadero "${c.nombre}"`);
  for (const l of ambiguos) log(`   ! ${l.fecha.toISOString().slice(0, 10)} ${l.litros} L "${l.proveedor}": coincide con varios ganaderos → no se toca`);
  const quitarProveedor = respaldo.leches.length - ambiguos.length;
  log(`   Se quita proveedor de ${quitarProveedor} registros`);

  // Semanas pagadas que cambiarían al asignar leche (no debería haber: esa leche no estaba en ninguna)
  for (const a of asignar.filter(x => x.ganaderoId)) {
    const { semana, anio } = semanaDeFecha(a.leche.fecha);
    const pagada = await col('liquidaciones').findOne({ usuarioId: a.leche.usuarioId, ganaderoId: a.ganaderoId, semana, anio, estado: 'pagado' });
    if (pagada) log(`   ! OJO: la liquidación pagada N° ${pagada.numero} (semana ${semana}) no incluía estos ${a.leche.litros} L; queda igual (pagada)`);
  }

  if (!APLICAR) {
    log('\nSimulación terminada: no se cambió nada. Para aplicar: --aplicar');
    return mongoose.disconnect();
  }

  // ── Aplicar ──
  const archivo = path.join(__dirname, `respaldo-${respaldo.fecha.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify(respaldo, null, 1));
  log(`\nRespaldo guardado en ${archivo}`);

  if ((await existe('pagos')) && nPagos === 0) { await col('pagos').drop(); log('pagos eliminada'); }

  for (const n of nuevos.values()) {
    await col('precioleches').updateOne(
      { usuarioId: n.usuarioId, semana: n.semana, anio: n.anio },
      { $setOnInsert: { precioLitro: n.precioLitro, createdAt: new Date(), updatedAt: new Date(), __v: 0 } },
      { upsert: true }
    );
  }
  const r2 = await col('precios').updateMany({ costoLitroLeche: { $exists: true } }, { $unset: { costoLitroLeche: '' } });
  log(`precioleches: ${nuevos.size} creados; costoLitroLeche quitado de ${r2.modifiedCount} precios`);

  const creados = new Map();
  for (const [clave, c] of porCrear) {
    const r = await col('ganaderos').insertOne({ usuarioId: c.usuarioId, nombre: c.nombre, activo: true, createdAt: new Date(), updatedAt: new Date(), __v: 0 });
    creados.set(clave, r.insertedId);
  }
  for (const a of asignar) {
    await col('leches').updateOne({ _id: a.leche._id }, { $set: { ganaderoId: a.ganaderoId ?? creados.get(a.clave) } });
  }
  const r3 = await col('leches').updateMany(
    { proveedor: { $exists: true }, ganaderoId: { $ne: null } }, { $unset: { proveedor: '' } }
  );
  log(`leche: ${asignar.length} registros asignados, ${creados.size} ganaderos creados, proveedor quitado de ${r3.modifiedCount}`);
  log('\nMigración aplicada.');
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
