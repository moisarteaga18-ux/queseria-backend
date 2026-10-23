const router = require('express').Router();
const { Producto, Movimiento } = require('../models');
const { errorHttp, responderError, registrarMovimiento } = require('../utils/inventario');
const { nombreIgual, textoOpcional } = require('../utils/texto');

function leerDatos(body) {
  const nombre = textoOpcional(body.nombre);
  if (!nombre) throw errorHttp(400, 'El nombre es obligatorio');
  const precioPorKg = Number(body.precioPorKg || 0);
  const stockMinimoKg = Number(body.stockMinimoKg || 0);
  if (!(precioPorKg >= 0) || !(stockMinimoKg >= 0)) throw errorHttp(400, 'Los valores no pueden ser negativos');
  return { nombre, descripcion: textoOpcional(body.descripcion) ?? null, precioPorKg, stockMinimoKg };
}

async function validarNombreUnico(usuarioId, nombre, excluirId) {
  const filtro = { usuarioId, nombre: nombreIgual(nombre) };
  if (excluirId) filtro._id = { $ne: excluirId };
  if (await Producto.exists(filtro)) throw errorHttp(400, `Ya existe un producto llamado "${nombre}"`);
}

// GET /api/productos
router.get('/', async (req, res) => {
  try {
    const productos = await Producto.find({ usuarioId: req.usuarioId }).collation({ locale: 'es' }).sort({ nombre: 1 });
    res.json({ ok: true, data: productos });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/productos  { nombre, descripcion, precioPorKg, stockMinimoKg, stockInicialKg }
router.post('/', async (req, res) => {
  try {
    const datos = leerDatos(req.body);
    const stockInicial = Number(req.body.stockInicialKg || 0);
    if (!(stockInicial >= 0)) throw errorHttp(400, 'El stock inicial no puede ser negativo');
    await validarNombreUnico(req.usuarioId, datos.nombre);

    let producto = await Producto.create({ ...datos, usuarioId: req.usuarioId, stockKg: 0 });
    if (stockInicial > 0) {
      producto = await registrarMovimiento(req.usuarioId, {
        productoId: producto._id, tipo: 'ENTRADA', cantidadKg: stockInicial, motivo: 'Stock inicial'
      });
    }
    res.status(201).json({ ok: true, data: producto });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/productos/:id  (el stock solo cambia con movimientos de inventario)
router.put('/:id', async (req, res) => {
  try {
    const datos = leerDatos(req.body);
    await validarNombreUnico(req.usuarioId, datos.nombre, req.params.id);
    const producto = await Producto.findOneAndUpdate(
      { _id: req.params.id, usuarioId: req.usuarioId }, datos, { new: true }
    );
    if (!producto) throw errorHttp(404, 'Producto no encontrado');
    res.json({ ok: true, data: producto });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/productos/:id  (borra también su historial de inventario)
router.delete('/:id', async (req, res) => {
  try {
    const producto = await Producto.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    if (producto) await Movimiento.deleteMany({ usuarioId: req.usuarioId, productoId: producto._id });
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
