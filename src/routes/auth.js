const router = require('express').Router();
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

const JWT_SECRET = process.env.JWT_SECRET || 'queseria-secret-2026';

// POST /api/auth/registro - crear cuenta nueva
router.post('/registro', async (req, res) => {
  try {
    const { username, password, nombreNegocio, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Usuario y contraseña requeridos' });
    }
    if (password.length < 4) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 4 caracteres' });
    }

    const existe = await Usuario.findOne({ username: username.toLowerCase() });
    if (existe) {
      return res.status(400).json({ ok: false, error: 'Ese usuario ya existe' });
    }

    const usuario = await Usuario.create({ username, password, nombreNegocio, email });
    const token = jwt.sign({ id: usuario._id, username: usuario.username }, JWT_SECRET, { expiresIn: '365d' });

    res.status(201).json({
      ok: true,
      data: {
        token,
        usuario: {
          id: usuario._id,
          username: usuario.username,
          nombreNegocio: usuario.nombreNegocio
        }
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/auth/login - iniciar sesión
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Usuario y contraseña requeridos' });
    }

    const usuario = await Usuario.findOne({ username: username.toLowerCase() });
    if (!usuario || !usuario.activo) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    const passwordValido = await usuario.compararPassword(password);
    if (!passwordValido) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    const token = jwt.sign({ id: usuario._id, username: usuario.username }, JWT_SECRET, { expiresIn: '365d' });

    res.json({
      ok: true,
      data: {
        token,
        usuario: {
          id: usuario._id,
          username: usuario.username,
          nombreNegocio: usuario.nombreNegocio
        }
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/auth/perfil - obtener datos del usuario actual
router.get('/perfil', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ ok: false, error: 'Sin token' });

    const token = auth.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    const usuario = await Usuario.findById(decoded.id).select('-password');

    if (!usuario) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    res.json({ ok: true, data: usuario });
  } catch (e) {
    res.status(401).json({ ok: false, error: 'Token inválido' });
  }
});

module.exports = router;