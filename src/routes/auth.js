const router = require('express').Router();
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { JWT_SECRET, JWT_ALGORITMO, JWT_DURACION } = require('../config');
const { leerToken } = require('../middleware/auth');
const limite = require('../utils/limite');

const MAX_FALLOS_USUARIO = 10; // por usuario (desde cualquier IP), cada 15 minutos
const MAX_FALLOS_IP = 30;      // por IP, cada 15 minutos

/**
 * IP real del cliente. Render tiene más de un proxy delante y req.ip puede variar entre
 * peticiones; la cabecera del proxy de borde (Cloudflare) trae la IP del cliente.
 * Aunque alguien la falsifique, el límite por usuario no depende de la IP.
 */
const ipDe = (req) => req.headers['cf-connecting-ip'] || req.headers['true-client-ip'] || req.ip;

function crearToken(usuario) {
  return jwt.sign(
    { id: usuario._id, username: usuario.username },
    JWT_SECRET,
    { algorithm: JWT_ALGORITMO, expiresIn: JWT_DURACION }
  );
}

function respuestaSesion(usuario) {
  return {
    token: crearToken(usuario),
    usuario: { id: usuario._id, username: usuario.username, nombreNegocio: usuario.nombreNegocio }
  };
}

/** Solo texto: evita que llegue un objeto ({ "$gt": "" }) a las consultas de Mongo. */
const esTexto = (v) => typeof v === 'string' && v.trim().length > 0;

// POST /api/auth/registro - crear cuenta nueva
router.post('/registro', async (req, res) => {
  try {
    const { username, password, nombreNegocio, email } = req.body;
    if (!esTexto(username) || !esTexto(password)) {
      return res.status(400).json({ ok: false, error: 'Usuario y contraseña requeridos' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    if (username.length > 50) {
      return res.status(400).json({ ok: false, error: 'El usuario es demasiado largo' });
    }

    const existe = await Usuario.findOne({ username: username.toLowerCase().trim() });
    if (existe) {
      return res.status(400).json({ ok: false, error: 'Ese usuario ya existe' });
    }

    const usuario = await Usuario.create({
      username,
      password,
      nombreNegocio: typeof nombreNegocio === 'string' ? nombreNegocio : undefined,
      email: typeof email === 'string' ? email : undefined
    });
    res.status(201).json({ ok: true, data: respuestaSesion(usuario) });
  } catch (e) {
    console.error('Error en registro:', e);
    res.status(500).json({ ok: false, error: 'No se pudo crear la cuenta' });
  }
});

// POST /api/auth/login - iniciar sesión (con límite de intentos fallidos)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!esTexto(username) || !esTexto(password)) {
      return res.status(400).json({ ok: false, error: 'Usuario y contraseña requeridos' });
    }

    const nombre = username.toLowerCase().trim();
    const claveUsuario = `u:${nombre}`;
    const claveIp = `ip:${ipDe(req)}`;
    if (limite.bloqueado(claveUsuario, MAX_FALLOS_USUARIO) || limite.bloqueado(claveIp, MAX_FALLOS_IP)) {
      return res.status(429).json({ ok: false, error: 'Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.' });
    }

    const usuario = await Usuario.findOne({ username: nombre });
    const valido = usuario && usuario.activo && await usuario.compararPassword(password);
    if (!valido) {
      limite.registrarFallo(claveUsuario);
      limite.registrarFallo(claveIp);
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    limite.limpiar(claveUsuario);
    res.json({ ok: true, data: respuestaSesion(usuario) });
  } catch (e) {
    console.error('Error en login:', e);
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
  }
});

// GET /api/auth/perfil - obtener datos del usuario actual
router.get('/perfil', async (req, res) => {
  try {
    const decoded = leerToken(req);
    if (!decoded) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    const usuario = await Usuario.findById(decoded.id).select('-password');
    if (!usuario || !usuario.activo) return res.status(401).json({ ok: false, error: 'Usuario no encontrado' });
    res.json({ ok: true, data: usuario });
  } catch (e) {
    res.status(401).json({ ok: false, error: 'Token inválido' });
  }
});

module.exports = router;
