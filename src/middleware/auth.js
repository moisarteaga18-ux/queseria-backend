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

/** false si el token se emitió antes del último cambio de contraseña (iat va en segundos). */
function tokenVigente(decoded, usuario) {
  if (!usuario.passwordCambiadoEn) return true;
  return decoded.iat >= Math.floor(new Date(usuario.passwordCambiadoEn).getTime() / 1000);
}

async function verificarToken(req, res, next) {
  try {
    const decoded = leerToken(req);
    if (!decoded) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    // El usuario tiene que seguir existiendo y estar activo (si se desactiva, pierde el acceso),
    // y el token debe ser posterior al último cambio de contraseña
    const usuario = await Usuario.findOne({ _id: decoded.id, activo: true }).select('passwordCambiadoEn').lean();
    if (!usuario || !tokenVigente(decoded, usuario)) {
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
