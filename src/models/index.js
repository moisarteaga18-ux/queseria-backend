const mongoose = require('mongoose');

// ── Entrada de leche diaria ──────────────────────────────────────────────────
const lecheSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  litros: { type: Number, required: true, min: 0 },
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
  cantidad: { type: Number, required: true, min: 0 },
  unidad: { type: String, enum: ['kg', 'libras'], required: true },
  precioUnitario: { type: Number, required: true },
  totalVenta: { type: Number, required: true },
  precioRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Precio' }
}, { timestamps: true });

module.exports = {
  Leche: mongoose.model('Leche', lecheSchema),
  Produccion: mongoose.model('Produccion', produccionSchema),
  Precio: mongoose.model('Precio', precioSchema),
  Venta: mongoose.model('Venta', ventaSchema)
};