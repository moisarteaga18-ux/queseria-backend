const mongoose = require('mongoose');

// ── Entrada de leche diaria ──────────────────────────────────────────────────
const lecheSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  litros: { type: Number, required: true, min: 0 },
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', index: true },
  // Nombre del ganadero al momento del registro (o texto libre en registros antiguos)
  proveedor: { type: String, default: 'Principal' },
  observaciones: { type: String }
}, { timestamps: true });

// ── Producción de queso ──────────────────────────────────────────────────────
const produccionSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  litrosUsados: { type: Number, required: true },
  kgProducidos: { type: Number, required: true },
  rendimiento: { type: Number },
  // Producto al que se sumó el queso en el inventario (opcional)
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
  observaciones: { type: String }
}, { timestamps: true });

produccionSchema.pre('save', function(next) {
  if (this.litrosUsados && this.kgProducidos) {
    this.rendimiento = parseFloat((this.litrosUsados / this.kgProducidos).toFixed(2));
  }
  next();
});

// ── Precio semanal ───────────────────────────────────────────────────────────
const precioSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  precioPorKg: { type: Number, required: true, min: 0 },
  costoLitroLeche: { type: Number, default: 0 },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

precioSchema.virtual('precioPorLibra').get(function() {
  return parseFloat((this.precioPorKg / 2.2046).toFixed(0));
});
precioSchema.set('toJSON', { virtuals: true });

// ── Ventas ───────────────────────────────────────────────────────────────────
const ventaSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  tipoVenta: { type: String, enum: ['mayorista', 'libras'], required: true },
  cliente: { type: String },
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', index: true },
  // Producto descontado del inventario (opcional)
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
  cantidad: { type: Number, required: true, min: 0 },
  unidad: { type: String, enum: ['kg', 'libras'], required: true },
  precioUnitario: { type: Number, required: true },
  totalVenta: { type: Number, required: true },
  precioRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Precio' }
}, { timestamps: true });

// ── Producto (tipo de queso). El stock se guarda en kilos ──────────────────────
const productoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  descripcion: { type: String },
  precioPorKg: { type: Number, default: 0, min: 0 },
  stockKg: { type: Number, default: 0 },
  stockMinimoKg: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

// ── Movimiento de inventario. cantidadKg > 0 entra, < 0 sale ───────────────────
const movimientoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true, index: true },
  tipo: { type: String, enum: ['ENTRADA', 'SALIDA', 'AJUSTE'], required: true },
  cantidadKg: { type: Number, required: true },
  motivo: { type: String },
  // Id de la venta o producción que originó el movimiento (si aplica)
  referencia: { type: String, index: true },
  fecha: { type: Date, default: Date.now }
}, { timestamps: true });

// ── Cliente ──────────────────────────────────────────────────────────────────
const clienteSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  telefono: { type: String },
  direccion: { type: String },
  tipo: { type: String, enum: ['Mayorista', 'Minorista'], default: 'Minorista' },
  notas: { type: String }
}, { timestamps: true });

// ── Ganadero (proveedor de leche) ────────────────────────────────────────────
const ganaderoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  telefono: { type: String },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

// ── Precio del litro de leche que se paga a los ganaderos, por semana ISO ─────
const precioLecheSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  precioLitro: { type: Number, required: true, min: 0 }
}, { timestamps: true });
precioLecheSchema.index({ usuarioId: 1, anio: 1, semana: 1 }, { unique: true });

// ── Pago semanal a un ganadero. Guarda una copia de lo que se pagó ────────────
const pagoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', required: true },
  nombreGanadero: { type: String },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  litros: { type: Number, required: true },
  precioLitro: { type: Number, required: true },
  total: { type: Number, required: true },
  fechaPago: { type: Date, default: Date.now },
  notas: { type: String }
}, { timestamps: true });
pagoSchema.index({ usuarioId: 1, ganaderoId: 1, anio: 1, semana: 1 }, { unique: true });

module.exports = {
  Leche: mongoose.model('Leche', lecheSchema),
  Produccion: mongoose.model('Produccion', produccionSchema),
  Precio: mongoose.model('Precio', precioSchema),
  Venta: mongoose.model('Venta', ventaSchema),
  Producto: mongoose.model('Producto', productoSchema),
  Movimiento: mongoose.model('Movimiento', movimientoSchema),
  Cliente: mongoose.model('Cliente', clienteSchema),
  Ganadero: mongoose.model('Ganadero', ganaderoSchema),
  PrecioLeche: mongoose.model('PrecioLeche', precioLecheSchema),
  Pago: mongoose.model('Pago', pagoSchema)
};