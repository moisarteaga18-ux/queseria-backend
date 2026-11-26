const router = require('express').Router();
const { Cliente, Venta } = require('../models');
const { errorHttp, responderError } = require('../utils/inventario');
const { nombreIgual, textoOpcional } = require('../utils/texto');
const { cuentasPorCobrar, debeCliente, conEstado } = require('../utils/cobros');

function leerDatos(body) {
  const nombre = textoOpcional(body.nombre);
  if (!nombre) throw errorHttp(400, 'El nombre es obligatorio');
  return {
    nombre,
    telefono: textoOpcional(body.telefono) ?? null,
    direccion: textoOpcional(body.direccion) ?? null,
    tipo: body.tipo === 'Mayorista' ? 'Mayorista' : 'Minorista',
    notas: textoOpcional(body.notas) ?? null
  };
}

async function validarNombreUnico(usuarioId, nombre, excluirId) {
  const filtro = { usuarioId, nombre: nombreIgual(nombre) };
  if (excluirId) filtro._id = { $ne: excluirId };
  if (await Cliente.exists(filtro)) throw errorHttp(400, `Ya existe un cliente llamado "${nombre}"`);
}

// GET /api/clientes
router.get('/', async (req, res) => {
  try {
    const clientes = await Cliente.find({ usuarioId: req.usuarioId }).collation({ locale: 'es' }).sort({ nombre: 1 });
    // Cuánto debe cada uno (ventas fiadas con saldo)
    const { clientes: deudas } = await cuentasPorCobrar(req.usuarioId);
    const debe = new Map(deudas.filter(d => d.clienteId).map(d => [String(d.clienteId), d.debe]));
    res.json({ ok: true, data: clientes.map(c => ({ ...c.toJSON(), debe: debe.get(String(c._id)) || 0 })) });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/clientes/:id
router.get('/:id', async (req, res) => {
  try {
    const cliente = await Cliente.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!cliente) throw errorHttp(404, 'Cliente no encontrado');
    res.json({ ok: true, data: { ...cliente.toJSON(), debe: await debeCliente(req.usuarioId, cliente._id) } });
  } catch (e) {
    responderError(res, e);
  }
});

// GET /api/clientes/:id/ventas — ventas ligadas al cliente (o, si son antiguas, con su mismo nombre)
router.get('/:id/ventas', async (req, res) => {
  try {
    const cliente = await Cliente.findOne({ _id: req.params.id, usuarioId: req.usuarioId });
    if (!cliente) throw errorHttp(404, 'Cliente no encontrado');
    const ventas = await Venta.find({
      usuarioId: req.usuarioId,
      $or: [
        { clienteId: cliente._id },
        { clienteId: null, cliente: nombreIgual(cliente.nombre) }
      ]
    }).sort({ fecha: -1 }).limit(500);
    res.json({ ok: true, data: await conEstado(req.usuarioId, ventas) });
  } catch (e) {
    responderError(res, e);
  }
});

// POST /api/clientes
router.post('/', async (req, res) => {
  try {
    const datos = leerDatos(req.body);
    await validarNombreUnico(req.usuarioId, datos.nombre);
    const cliente = await Cliente.create({ ...datos, usuarioId: req.usuarioId });
    res.status(201).json({ ok: true, data: cliente });
  } catch (e) {
    responderError(res, e);
  }
});

// PUT /api/clientes/:id  (si cambia el nombre, se actualiza también en sus ventas)
router.put('/:id', async (req, res) => {
  try {
    const datos = leerDatos(req.body);
    await validarNombreUnico(req.usuarioId, datos.nombre, req.params.id);
    const anterior = await Cliente.findOneAndUpdate({ _id: req.params.id, usuarioId: req.usuarioId }, datos);
    if (!anterior) throw errorHttp(404, 'Cliente no encontrado');
    if (anterior.nombre !== datos.nombre) {
      await Venta.updateMany(
        {
          usuarioId: req.usuarioId,
          $or: [{ clienteId: anterior._id }, { clienteId: null, cliente: nombreIgual(anterior.nombre) }]
        },
        { cliente: datos.nombre, clienteId: anterior._id }
      );
    }
    res.json({ ok: true, data: { ...anterior.toObject(), ...datos } });
  } catch (e) {
    responderError(res, e);
  }
});

// DELETE /api/clientes/:id  (sus ventas no se borran)
router.delete('/:id', async (req, res) => {
  try {
    await Cliente.findOneAndDelete({ _id: req.params.id, usuarioId: req.usuarioId });
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});

module.exports = router;
