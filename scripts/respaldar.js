// Respaldo completo de la base de MongoDB en un archivo JSON con la fecha en el nombre.
//
//   node scripts/respaldar.js
//   (o doble clic en scripts\respaldo-semanal.cmd)
//
// Carpeta: RESPALDOS_DIR (en .env) o, por defecto, "Respaldos QuesoData" en la carpeta del usuario
// (fuera del repositorio: nunca se sube a GitHub). Usa MONGODB_URI del .env.
// El archivo está en Extended JSON: conserva los tipos (ObjectId, fechas, double) para poder restaurarlo.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const os = require('os');
const path = require('path');

function carpetaRespaldos() {
  const carpeta = process.env.RESPALDOS_DIR || path.join(os.homedir(), 'Respaldos QuesoData');
  fs.mkdirSync(carpeta, { recursive: true });
  return carpeta;
}

async function respaldar() {
  const mongoose = require('mongoose');
  const { EJSON } = require('bson');
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI en el .env');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const db = mongoose.connection.db;
    const ahora = new Date();
    const datos = { base: db.databaseName, fecha: ahora.toISOString(), colecciones: {} };
    const nombres = (await db.listCollections().toArray()).map(c => c.name).sort();
    for (const n of nombres) datos.colecciones[n] = await db.collection(n).find().toArray();

    // queseria-2026-10-26_1430.json (hora local, para que varios respaldos del mismo día no se pisen)
    const d = (n) => String(n).padStart(2, '0');
    const sello = `${ahora.getFullYear()}-${d(ahora.getMonth() + 1)}-${d(ahora.getDate())}_${d(ahora.getHours())}${d(ahora.getMinutes())}`;
    const archivo = path.join(carpetaRespaldos(), `queseria-${sello}.json`);
    fs.writeFileSync(archivo, EJSON.stringify(datos, null, 1, { relaxed: false }));

    console.log(`Respaldo guardado: ${archivo} (${(fs.statSync(archivo).size / 1024).toFixed(0)} KB)`);
    for (const n of nombres) console.log(`  ${n}: ${datos.colecciones[n].length}`);
    return archivo;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  respaldar().catch((e) => {
    console.error('ERROR en el respaldo:', e.message);
    process.exit(1);
  });
}

module.exports = { respaldar, carpetaRespaldos };
