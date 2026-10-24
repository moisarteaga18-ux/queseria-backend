// Configuración sensible: solo desde variables de entorno (en Render: Environment).
// Nunca se deja un valor por defecto en el código: el repositorio es público.

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('❌ Falta JWT_SECRET (mínimo 32 caracteres). Defínelo en las variables de entorno.');
  process.exit(1);
}

module.exports = {
  JWT_SECRET,
  // Algoritmo fijo: jwt.verify no acepta tokens firmados con otro (p. ej. "none")
  JWT_ALGORITMO: 'HS256',
  JWT_DURACION: '180d'
};
