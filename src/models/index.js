const mongoose = require('mongoose');

// ── Entrada de leche diaria ──────────────────────────────────────────────────
const lecheSchema = new mongoose.Schema({
  fecha: { type: Date, required: true, default: Date.now },
  litros: { type: Number, required: true, min: 0 },
  proveedor: { type: String, default: 'Principal' },
  observaciones: { type: String }
}, { timestamps: true });

// ── Producción de queso ──────────────────────────────────────────────────────
// Tú ingresas: litrosRecibidos + kgPesados
// La app calcula: latas, libras totales, libras por lata (métrica principal)
const produccionSchema = new mongoose.Schema({
  fecha:         { type: Date, required: true, default: Date.now },
  litrosUsados:  { type: Number, required: true },  // litros recibidos ese día
  kgProducidos:  { type: Number, required: true },  // kg que pesó el queso
  latasDelDia:   { type: Number },                  // litrosUsados / 20
  librasTotales: { type: Number },                  // kgProducidos * 2.2046
  librasPorLata: { type: Number },                  // MÉTRICA PRINCIPAL: lb / lata
  kgPorLata:     { type: Number },                  // kgProducidos / latasDelDia
  rendimiento:   { type: Number },                  // litros / kg
  observaciones: { type: String }
}, { timestamps: true });

// ── Precio semanal (lo define el proveedor) ──────────────────────────────────
const precioSchema = new mongoose.Schema({
  semana: { type: Number, required: true },  // número de semana del año
  anio: { type: Number, required: true },
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  precioPorKg: { type: Number, required: true, min: 0 },
  // precioPorLibra se calcula: precioPorKg / 2.2046
  activo: { type: Boolean, default: true }
}, { timestamps: true });

precioSchema.virtual('precioPorLibra').get(function() {
  return parseFloat((this.precioPorKg / 2.2046).toFixed(0));
});
precioSchema.set('toJSON', { virtuals: true });

// ── Ventas ───────────────────────────────────────────────────────────────────
const ventaSchema = new mongoose.Schema({
  fecha: { type: Date, required: true, default: Date.now },
  tipoVenta: { type: String, enum: ['mayorista', 'libras'], required: true },
  cliente: { type: String },
  // Mayorista: cantidad en kg / Libras: cantidad en libras
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
