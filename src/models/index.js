const mongoose = require('mongoose');
const { librasPorLata } = require('../utils/unidades');

/**
 * Número decimal: se guarda SIEMPRE como double en MongoDB (con Number, los valores sin decimales
 * quedaban como int y Atlas mostraba el campo con tipo mixto) y en el código se lee como número.
 * [min]: el tipo Double no aplica la regla min de Mongoose, por eso va como validador.
 * [positivo]: debe ser mayor que 0 (litros, kilos, cantidades y precios). Es la última defensa: las
 * rutas ya validan con utils/validar.js y responden un mensaje más claro.
 */
function decimal({ min, positivo, ...resto } = {}) {
  return {
    type: mongoose.Schema.Types.Double,
    get: (v) => (v == null ? v : Number(v)),
    ...(min !== undefined && {
      validate: { validator: (v) => v == null || Number(v) >= min, message: '{PATH} no puede ser menor que ' + min }
    }),
    ...(positivo && {
      validate: { validator: (v) => v == null || Number(v) > 0, message: '{PATH} debe ser mayor que 0' }
    }),
    ...resto
  };
}
// Los getters convierten el double a número también en las respuestas JSON
const opciones = { timestamps: true, toJSON: { getters: true }, toObject: { getters: true }, id: false };

// ── Entrada de leche diaria ──────────────────────────────────────────────────
const lecheSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  litros: decimal({ required: true, positivo: true }),
  // El nombre se toma siempre del ganadero (el campo viejo `proveedor` se migró y eliminó)
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', required: true, index: true },
  observaciones: { type: String },
  // Registro hecho sin internet: lo pone el teléfono para que un reenvío no lo duplique (utils/idLocal.js)
  idLocal: { type: String }
}, opciones);

// Un registro del teléfono se guarda una sola vez (solo los que traen idLocal)
lecheSchema.index({ usuarioId: 1, idLocal: 1 }, { unique: true, partialFilterExpression: { idLocal: { $type: 'string' } } });

// ── Producción de queso ──────────────────────────────────────────────────────
const produccionSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  litrosUsados: decimal({ required: true, positivo: true }),
  kgProducidos: decimal({ required: true, positivo: true }),
  // Libras de queso por lata (ver pre('save'))
  rendimiento: decimal(),
  // Producto al que se sumó el queso en el inventario (opcional)
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
  observaciones: { type: String },
  idLocal: { type: String }
}, opciones);

produccionSchema.index({ usuarioId: 1, idLocal: 1 }, { unique: true, partialFilterExpression: { idLocal: { $type: 'string' } } });

// Rendimiento = libras de queso por lata de leche = (kg × 2) ÷ (litros ÷ 20)
produccionSchema.pre('save', function(next) {
  if (this.litrosUsados && this.kgProducidos) this.rendimiento = librasPorLata(this.kgProducidos, this.litrosUsados);
  next();
});

// ── Precio semanal del queso ─────────────────────────────────────────────────
// El costo del litro de leche NO va aquí: está solo en PrecioLeche (lo que se paga a los ganaderos).
const precioSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  // Precio al por menor (minorista) y al por mayor, ambos por kg; cualquiera de los dos puede faltar
  precioPorKg: decimal({ positivo: true }),
  precioMayoristaPorKg: decimal({ positivo: true }),
  activo: { type: Boolean, default: true }
}, opciones);

// ── Ventas ───────────────────────────────────────────────────────────────────
const ventaSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  tipoVenta: { type: String, enum: ['mayorista', 'libras'], required: true },
  cliente: { type: String },
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', index: true },
  // Producto descontado del inventario (opcional)
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
  cantidad: decimal({ required: true, positivo: true }),
  unidad: { type: String, enum: ['kg', 'libras'], required: true },
  precioUnitario: decimal({ required: true, positivo: true }),
  totalVenta: decimal({ required: true }),
  precioRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Precio' },
  idLocal: { type: String },
  // true = venta fiada (el cliente paga después, con abonos). Sin el campo (todas las ventas antiguas) = pagada.
  // Pagada o pendiente se calcula siempre: lo que falta = total − abonos (utils/cobros.js).
  fiada: { type: Boolean }
}, opciones);

ventaSchema.index({ usuarioId: 1, idLocal: 1 }, { unique: true, partialFilterExpression: { idLocal: { $type: 'string' } } });

// ── Abono (pago parcial o total) a una venta fiada. Colección nueva `abonos` ───
const abonoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  ventaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venta', required: true, index: true },
  fecha: { type: Date, required: true },
  valor: decimal({ required: true, positivo: true }),
  nota: { type: String }
}, opciones);

// ── Producto (tipo de queso). El stock se guarda en kilos ──────────────────────
const productoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  descripcion: { type: String },
  precioPorKg: decimal({ default: 0, min: 0 }),
  stockKg: decimal({ default: 0 }),
  stockMinimoKg: decimal({ default: 0, min: 0 })
}, opciones);

// ── Movimiento de inventario. cantidadKg > 0 entra, < 0 sale ───────────────────
const movimientoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true, index: true },
  tipo: { type: String, enum: ['ENTRADA', 'SALIDA', 'AJUSTE'], required: true },
  cantidadKg: decimal({ required: true }),
  motivo: { type: String },
  // Id de la venta o producción que originó el movimiento (si aplica)
  referencia: { type: String, index: true },
  fecha: { type: Date, default: Date.now }
}, opciones);

// ── Cliente ──────────────────────────────────────────────────────────────────
const clienteSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  telefono: { type: String },
  direccion: { type: String },
  tipo: { type: String, enum: ['Mayorista', 'Minorista'], default: 'Minorista' },
  notas: { type: String }
}, opciones);

// ── Ganadero (proveedor de leche) ────────────────────────────────────────────
const ganaderoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  telefono: { type: String },
  activo: { type: Boolean, default: true }
}, opciones);

// ── Precio del litro de leche, por semana (viernes a jueves) ──────────────────
// Único lugar del costo del litro: lo usan las liquidaciones, Ganancias, Reportes y Precios.
const precioLecheSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  precioLitro: decimal({ required: true, positivo: true })
}, opciones);
precioLecheSchema.index({ usuarioId: 1, anio: 1, semana: 1 }, { unique: true });

// ── Descuento al ganadero (se registra durante la semana y se resta en su liquidación) ──
// tipo: adelanto (plata entregada antes del pago), prestamo (cuota de un préstamo),
// leche_rechazada (litros devueltos: se descuentan a precio del litro de la semana), otro.
const descuentoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', required: true, index: true },
  fecha: { type: Date, required: true },
  tipo: { type: String, enum: ['adelanto', 'prestamo', 'leche_rechazada', 'otro'], required: true },
  valor: decimal({ min: 0, default: 0 }),
  litros: decimal({ min: 0 }),
  descripcion: { type: String }
}, opciones);

// ── Liquidación semanal (viernes a jueves) de un ganadero ─────────────────────
// Mientras está pendiente se recalcula con la leche, el precio y los descuentos actuales;
// al marcarla como pagada queda congelada como comprobante.
const liquidacionSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  numero: { type: Number, required: true },
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', required: true, index: true },
  nombreGanadero: { type: String, required: true },
  telefonoGanadero: { type: String },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  dias: [{ _id: false, fecha: String, litros: decimal(), entregas: Number }],
  litros: decimal({ required: true }),
  precioLitro: decimal({ required: true }),
  subtotal: decimal({ required: true }),
  descuentos: [{
    _id: false,
    descuentoId: mongoose.Schema.Types.ObjectId,
    tipo: String,
    fecha: Date,
    descripcion: String,
    litros: decimal(),
    valor: decimal()
  }],
  totalDescuentos: decimal({ default: 0 }),
  total: decimal({ required: true }),
  estado: { type: String, enum: ['pendiente', 'pagado'], default: 'pendiente' },
  // Lo que se pagó. Si después se corrige la semana (con confirmación), `total` cambia y
  // la diferencia con este valor es lo que queda por ajustar con el ganadero.
  totalPagado: decimal(),
  fechaPago: { type: Date },
  formaPago: { type: String, enum: ['efectivo', 'nequi', 'transferencia'] },
  notas: { type: String }
}, opciones);
liquidacionSchema.index({ usuarioId: 1, ganaderoId: 1, anio: 1, semana: 1 }, { unique: true });
liquidacionSchema.index({ usuarioId: 1, numero: 1 }, { unique: true });

// ── Liquidaciones anuladas (historial) ──────────────────────────────────────────
// Al consultar una semana cerrada no se vuelve a generar sola la de ese ganadero:
// el usuario la anuló a propósito y la genera de nuevo a mano si la necesita.
const liquidacionAnuladaSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', required: true },
  nombreGanadero: { type: String },
  numero: { type: Number, required: true },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  total: decimal(),
  fechaAnulacion: { type: Date, default: Date.now }
}, opciones);
liquidacionAnuladaSchema.index({ usuarioId: 1, anio: 1, semana: 1 });

// ── Contadores por usuario (número consecutivo de liquidaciones) ───────────────
const contadorSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  nombre: { type: String, required: true },
  valor: { type: Number, default: 0 }
});
contadorSchema.index({ usuarioId: 1, nombre: 1 }, { unique: true });

// ── Cierre semanal del queso (viernes a jueves) con la merma calculada ──────────
// merma = stock inicial + producido − vendido − lo que pasa a la semana siguiente.
// El único dato que pone el usuario es kgFinal (por defecto 0); el resto se calcula.
const cierreSemanaSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  stockInicialKg: decimal({ default: 0 }),
  kgProducidos: decimal({ default: 0 }),
  kgVendidos: decimal({ default: 0 }),
  kgFinal: decimal({ default: 0, min: 0 }),
  // true cuando el usuario confirmó cuánto queso pasó a la semana siguiente
  confirmado: { type: Boolean, default: false },
  mermaKg: decimal({ default: 0 }),
  mermaPct: decimal({ default: 0 }),
  precioPorKg: decimal({ default: 0 }),
  valorMerma: decimal({ default: 0 })
}, opciones);
cierreSemanaSchema.index({ usuarioId: 1, anio: 1, semana: 1 }, { unique: true });

// ── Papelera: copia de lo que se borra, para recuperarlo durante 30 días ─────────
// Colección aparte: borrar o restaurar no cambia los demás registros. MongoDB elimina sola cada
// entrada cuando pasa su fecha `expiraEn` (índice TTL de esta colección).
const DIAS_PAPELERA = 30;
const papeleraSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  tipo: { type: String, enum: ['leche', 'produccion', 'venta', 'descuento', 'liquidacion', 'abono'], required: true },
  // Registros que se borraron junto con este (los abonos de una venta) y vuelven con él
  extra: { type: mongoose.Schema.Types.Mixed },
  // El registro tal como estaba (con su _id), para volver a crearlo igual
  documento: { type: mongoose.Schema.Types.Mixed, required: true },
  // Lo que se muestra en la lista: fecha del registro, nombre, cantidad y valor
  resumen: {
    fecha: Date,
    nombre: String,
    cantidad: String,
    valor: Number
  },
  borradoEn: { type: Date, default: Date.now },
  expiraEn: { type: Date, default: () => new Date(Date.now() + DIAS_PAPELERA * 24 * 60 * 60 * 1000) }
}, { ...opciones, minimize: false });
papeleraSchema.index({ expiraEn: 1 }, { expireAfterSeconds: 0 });

module.exports = {
  Papelera: mongoose.model('Papelera', papeleraSchema, 'papelera'),
  DIAS_PAPELERA,
  Leche: mongoose.model('Leche', lecheSchema),
  Produccion: mongoose.model('Produccion', produccionSchema),
  Precio: mongoose.model('Precio', precioSchema),
  Venta: mongoose.model('Venta', ventaSchema),
  Abono: mongoose.model('Abono', abonoSchema, 'abonos'),
  Producto: mongoose.model('Producto', productoSchema),
  Movimiento: mongoose.model('Movimiento', movimientoSchema),
  Cliente: mongoose.model('Cliente', clienteSchema),
  Ganadero: mongoose.model('Ganadero', ganaderoSchema),
  PrecioLeche: mongoose.model('PrecioLeche', precioLecheSchema),
  Descuento: mongoose.model('Descuento', descuentoSchema),
  Liquidacion: mongoose.model('Liquidacion', liquidacionSchema, 'liquidaciones'),
  LiquidacionAnulada: mongoose.model('LiquidacionAnulada', liquidacionAnuladaSchema, 'liquidaciones_anuladas'),
  Contador: mongoose.model('Contador', contadorSchema),
  CierreSemana: mongoose.model('CierreSemana', cierreSemanaSchema, 'cierres_semana')
};