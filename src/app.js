// Aplicación Express (rutas y middleware), sin conexión a la base ni puerto.
// La usan src/index.js (servidor real) y las pruebas automáticas (test/), que la conectan a una
// MongoDB temporal en memoria. Este archivo NO lee el .env.
require('./config'); // Sale con error si falta JWT_SECRET (antes de aceptar peticiones)
const express = require('express');
const cors = require('cors');
const { verificarToken } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');
// Render pone proxies delante: req.ip toma la IP del último (el límite de login usa además la cabecera del proxy de borde)
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Ruta pública de bienvenida
app.get('/', (req, res) => {
  res.json({ ok: true, mensaje: '🧀 API Quesería funcionando' });
});

// Ruta de autenticación (NO requiere token)
app.use('/api/auth', require('./routes/auth'));

// Todas las demás rutas requieren token (usuario logueado)
app.use('/api/leche', verificarToken, require('./routes/leche'));
app.use('/api/produccion', verificarToken, require('./routes/produccion'));
app.use('/api/ventas', verificarToken, require('./routes/ventas'));
app.use('/api/abonos', verificarToken, require('./routes/abonos'));
app.use('/api/precios', verificarToken, require('./routes/precios'));
app.use('/api/resumen', verificarToken, require('./routes/resumen'));
app.use('/api/rendimiento', verificarToken, require('./routes/rendimiento'));
app.use('/api/productos', verificarToken, require('./routes/productos'));
app.use('/api/inventario', verificarToken, require('./routes/inventario'));
app.use('/api/clientes', verificarToken, require('./routes/clientes'));
app.use('/api/ganaderos', verificarToken, require('./routes/ganaderos'));
app.use('/api/liquidaciones', verificarToken, require('./routes/liquidaciones'));
app.use('/api/descuentos', verificarToken, require('./routes/descuentos'));
app.use('/api/merma', verificarToken, require('./routes/merma'));
app.use('/api/papelera', verificarToken, require('./routes/papelera'));

module.exports = app;
