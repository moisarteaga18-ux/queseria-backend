const router = require('express').Router();
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { JWT_SECRET, JWT_ALGORITMO, JWT_DURACION } = require('../config');
const { verificarToken } = require('../middleware/auth');
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

const CAMPOS_PRIVADOS = '-password -passwordCambiadoEn';

// GET /api/auth/perfil - obtener datos del usuario actual
router.get('/perfil', verificarToken, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.usuarioId).select(CAMPOS_PRIVADOS);
    if (!usuario) return res.status(401).json({ ok: false, error: 'Usuario no encontrado' });
    res.json({ ok: true, data: usuario });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'No se pudo cargar el perfil' });
  }
});

/** Texto opcional del perfil: recortado, vacío → se borra (null), con largo máximo. */
function campoPerfil(valor, nombre, maximo = 100) {
  if (valor === undefined) return undefined; // no se cambia
  if (valor === null) return null;
  if (typeof valor !== 'string') throw Object.assign(new Error(`${nombre} inválido`), { status: 400 });
  const t = valor.trim();
  if (t.length > maximo) throw Object.assign(new Error(`${nombre} es demasiado largo`), { status: 400 });
  return t.length ? t : null;
}

// PUT /api/auth/perfil  { nombreNegocio, propietario, telefono, email, direccion, nit }
// Solo cambia los campos enviados. El usuario (username) no se cambia.
router.put('/perfil', verificarToken, async (req, res) => {
  try {
    const b = req.body || {};
    const cambios = {
      nombreNegocio: campoPerfil(b.nombreNegocio, 'El nombre del negocio'),
      propietario: campoPerfil(b.propietario, 'El nombre del dueño'),
      telefono: campoPerfil(b.telefono, 'El teléfono', 30),
      email: campoPerfil(b.email, 'El correo'),
      direccion: campoPerfil(b.direccion, 'La dirección', 150),
      nit: campoPerfil(b.nit, 'El NIT o cédula', 30)
    };
    if (cambios.nombreNegocio === null) return res.status(400).json({ ok: false, error: 'Escribe el nombre del negocio' });
    if (cambios.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cambios.email)) {
      return res.status(400).json({ ok: false, error: 'El correo no es válido' });
    }
    const $set = {}, $unset = {};
    for (const [k, v] of Object.entries(cambios)) {
      if (v === undefined) continue;
      if (v === null) $unset[k] = 1; else $set[k] = k === 'email' ? v.toLowerCase() : v;
    }
    const usuario = await Usuario.findByIdAndUpdate(req.usuarioId, { $set, $unset }, { new: true }).select(CAMPOS_PRIVADOS);
    res.json({ ok: true, data: usuario });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'No se pudo guardar el perfil' });
  }
});

// PUT /api/auth/contrasena  { actual, nueva }
// Pide la contraseña actual (con el mismo límite de intentos del login). Al cambiarla, las
// sesiones abiertas en otros teléfonos dejan de valer; este recibe un token nuevo.
router.put('/contrasena', verificarToken, async (req, res) => {
  try {
    const { actual, nueva } = req.body || {};
    if (!esTexto(actual) || !esTexto(nueva)) {
      return res.status(400).json({ ok: false, error: 'Escribe la contraseña actual y la nueva' });
    }
    if (nueva.length < 6) {
      return res.status(400).json({ ok: false, error: 'La contraseña nueva debe tener al menos 6 caracteres' });
    }
    if (nueva.length > 100) {
      return res.status(400).json({ ok: false, error: 'La contraseña nueva es demasiado larga' });
    }

    const usuario = await Usuario.findById(req.usuarioId);
    const claveUsuario = `u:${usuario.username}`;
    if (limite.bloqueado(claveUsuario, MAX_FALLOS_USUARIO)) {
      return res.status(429).json({ ok: false, error: 'Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.' });
    }
    if (!(await usuario.compararPassword(actual))) {
      limite.registrarFallo(claveUsuario);
      return res.status(400).json({ ok: false, error: 'La contraseña actual no es correcta' });
    }
    if (actual === nueva) {
      return res.status(400).json({ ok: false, error: 'La contraseña nueva debe ser distinta de la actual' });
    }

    limite.limpiar(claveUsuario);
    usuario.password = nueva; // se encripta al guardar
    // Redondeado al segundo: el token nuevo (emitido ahora, iat en segundos) sigue valiendo
    usuario.passwordCambiadoEn = new Date(Math.floor(Date.now() / 1000) * 1000);
    await usuario.save();
    res.json({ ok: true, data: respuestaSesion(usuario) });
  } catch (e) {
    console.error('Error al cambiar la contraseña:', e);
    res.status(500).json({ ok: false, error: 'No se pudo cambiar la contraseña' });
  }
});

module.exports = router;
