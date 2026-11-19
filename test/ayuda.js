// Entorno de las pruebas automáticas: MongoDB TEMPORAL EN MEMORIA + la app Express en un puerto libre.
//
// REGLA DE DATOS REALES: las pruebas nunca usan la base de producción.
// - No se carga el .env (dotenv solo se usa en src/index.js, que las pruebas no importan).
// - MONGODB_URI se borra del entorno y la URI se comprueba: si no es 127.0.0.1, la prueba se detiene.
// - Al terminar se apaga la base en memoria y sus datos desaparecen.
const { once } = require('node:events');
const { MongoMemoryServer } = require('mongodb-memory-server');

delete process.env.MONGODB_URI;
process.env.JWT_SECRET = 'secreto-solo-para-pruebas-automaticas-0123456789';

async function iniciar() {
  const mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  const uri = mongo.getUri();
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
    await mongo.stop();
    throw new Error(`Las pruebas solo pueden usar una base local en memoria (URI recibida: ${uri})`);
  }

  const mongoose = require('mongoose');
  await mongoose.connect(uri, { dbName: 'queseria_pruebas' });
  const app = require('../src/app');
  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const base = `http://127.0.0.1:${servidor.address().port}/api`;

  /** Llama a la API y devuelve { status, body }. [token]: JWT (null = sin cabecera Authorization). */
  async function api(metodo, ruta, cuerpo, token) {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }

  /** Crea un usuario nuevo y devuelve su token. */
  async function crearUsuario(username, password = 'clave123') {
    const r = await api('POST', '/auth/registro', { username, password });
    if (r.status !== 201) throw new Error(`No se pudo crear el usuario de prueba: ${JSON.stringify(r.body)}`);
    return r.body.data.token;
  }

  async function cerrar() {
    servidor.closeAllConnections?.();
    await new Promise((ok) => servidor.close(ok));
    await mongoose.disconnect();
    await mongo.stop();
  }

  return { api, crearUsuario, cerrar, mongoose };
}

/** "yyyy-MM-dd" del día [dias] después de [fecha] (UTC). */
function diaIso(fecha, dias = 0) {
  return new Date(fecha.getTime() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = { iniciar, diaIso };
