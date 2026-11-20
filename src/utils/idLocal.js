// Registros hechos en el teléfono sin internet (leche, producción y ventas).
// La app les pone un idLocal (UUID) y los reenvía hasta que el servidor responde. Si un envío llega dos
// veces (se cortó la conexión después de guardar, o dos intentos a la vez), el servidor devuelve el que ya
// guardó en lugar de crear otro: cada registro se sube una sola vez.
const { errorHttp } = require('./inventario');

const FORMATO = /^[A-Za-z0-9-]{8,64}$/;

/** idLocal del cuerpo (undefined si no viene) o 400 si no tiene el formato esperado. */
function idLocalDe(req) {
  const v = req.body?.idLocal;
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !FORMATO.test(v)) throw errorHttp(400, 'El identificador del registro del teléfono no es válido');
  return v;
}

/** El registro que ya se guardó con ese idLocal (del mismo usuario), o null. */
function yaGuardado(Modelo, req, idLocal) {
  return idLocal ? Modelo.findOne({ usuarioId: req.usuarioId, idLocal }) : null;
}

/** El error de MongoDB por índice único repetido (dos envíos del mismo registro al mismo tiempo). */
const esRepetido = (e) => e?.code === 11000 && /idLocal/.test(e.message || '');

module.exports = { idLocalDe, yaGuardado, esRepetido };
