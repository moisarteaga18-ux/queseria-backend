const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'queseria-secret-2026';

function verificarToken(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ ok: false, error: 'Sin token de autenticación' });

    const token = auth.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);

    req.usuarioId = decoded.id;
    req.username = decoded.username;
    next();
  } catch (e) {
    res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
}

module.exports = { verificarToken };