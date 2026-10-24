// Límite de intentos fallidos (en memoria) para frenar a quien prueba contraseñas.
// Si el servidor se reinicia, los contadores empiezan de cero; para una sola instancia en Render basta.

const VENTANA_MS = 15 * 60 * 1000;
const intentos = new Map(); // clave → { fallos, desde }

function vigente(clave) {
  const r = intentos.get(clave);
  if (!r) return null;
  if (Date.now() - r.desde > VENTANA_MS) { intentos.delete(clave); return null; }
  return r;
}

/** true si la clave ya superó [maximo] fallos en los últimos 15 minutos. */
function bloqueado(clave, maximo) {
  const r = vigente(clave);
  return !!r && r.fallos >= maximo;
}

function registrarFallo(clave) {
  const r = vigente(clave) || { fallos: 0, desde: Date.now() };
  r.fallos += 1;
  intentos.set(clave, r);
}

function limpiar(clave) {
  intentos.delete(clave);
}

// Limpieza periódica para que el mapa no crezca sin control
setInterval(() => {
  const ahora = Date.now();
  for (const [k, r] of intentos) if (ahora - r.desde > VENTANA_MS) intentos.delete(k);
}, VENTANA_MS).unref();

module.exports = { bloqueado, registrarFallo, limpiar };
