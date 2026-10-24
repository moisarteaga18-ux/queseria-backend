const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { JWT_SECRET, JWT_ALGORITMO } = require('../config');

/** Lee y valida el token "Bearer ..." de la petición; devuelve su contenido o null. */
function leerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), JWT_SECRET, { algorithms: [JWT_ALGORITMO] });
  } catch (e) {
    return null;
  }
}

async function verificarToken(req, res, next) {
  try {
    const decoded = leerToken(req);
    if (!decoded) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    // El usuario tiene que seguir existiendo y estar activo (si se desactiva, pierde el acceso)
    if (!(await Usuario.exists({ _id: decoded.id, activo: true }))) {
      return res.status(401).json({ ok: false, error: 'Tu sesión ya no es válida. Inicia sesión de nuevo.' });
    }

    req.usuarioId = decoded.id;
    req.username = decoded.username;
    next();
  } catch (e) {
    res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
}

module.exports = { verificarToken, leerToken };
