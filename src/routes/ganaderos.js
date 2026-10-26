const router = require('express').Router();
const { Ganadero, Leche, Liquidacion, Descuento } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { nombreIgual, textoOpcional } = require('../utils/texto');

function leerDatos(body) {
  const nombre = textoOpcional(body.nombre);
  if (!nombre) throw errorHttp(400, 'El nombre es obligatorio');
  return { nombre, telefono: textoOpcional(body.telefono) ?? null };
}

async function validarNombreUnico(usuarioId, nombre, excluirId) {
  const filtro = { usuarioId, activo: true, nombre: nombreIgual(nombre) };
  if (excluirId) filtro._id = { $ne: excluirId };
  if (await Ganadero.exists(filtro)) throw errorHttp(400, `Ya existe un ganadero llamado "${nombre}"`);
}

// GET /api/ganaderos?todos=true  (por defecto solo los activos)
router.get('/', async (req, res) => {
  try {
    const filtro = { usuarioId: req.usuarioId };
    if (req.query.todos !== 'true') filtro.activo = true;
    const ganaderos = await Ganadero.find(filtro).collation({ locale: 'es' }).sort({ nombre: 1 });
    res.json({ ok: true, data: ganaderos });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/ganaderos  { nombre, telefono }
router.post('/', async (req, res) => {
  try {
    const datos = leerDatos(req.body);
    await validarNombreUnico(req.usuarioId, datos.nombre);
    const ganadero = await Ganadero.create({ ...datos, usuarioId: req.usuarioId });
    res.status(201).json({ ok: true, data: ganadero });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/ganaderos/:id  (los registros de leche toman el nombre de aquí)
router.put('/:id', async (req, res) => {
  try {
    const datos = leerDatos(req.body);
    await validarNombreUnico(req.usuarioId, datos.nombre, req.params.id);
    const ganadero = await Ganadero.findOneAndUpdate(
      { _id: req.params.id, usuarioId: req.usuarioId }, datos, { new: true }
    );
    if (!ganadero) throw errorHttp(404, 'Ganadero no encontrado');
    res.json({ ok: true, data: ganadero });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/ganaderos/:id
// Si ya tiene leche, liquidaciones o descuentos, solo se archiva (para no perder el historial).
router.delete('/:id', async (req, res) => {
  try {
    const filtro = { usuarioId: req.usuarioId, ganaderoId: req.params.id };
    const tieneHistorial = (await Leche.exists(filtro)) || (await Liquidacion.exists(filtro)) || (await Descuento.exists(filtro));
    if (tieneHistorial) {
      await Ganadero.updateOne({ _id: req.params.id, usuarioId: req.usuarioId }, { activo: false });
      return res.json({ ok: true, data: { archivado: true } });
    }
    await Ganadero.deleteOne({ _id: req.params.id, usuarioId: req.usuarioId });
    res.json({ ok: true, data: { archivado: false } });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
