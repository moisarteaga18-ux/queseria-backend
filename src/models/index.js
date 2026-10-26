const mongoose = require('mongoose');

// ── Entrada de leche diaria ──────────────────────────────────────────────────
const lecheSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  litros: { type: Number, required: true, min: 0 },
  // El nombre se toma siempre del ganadero (el campo viejo `proveedor` se migró y eliminó)
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', required: true, index: true },
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

// ── Precio semanal del queso ─────────────────────────────────────────────────
// El costo del litro de leche NO va aquí: está solo en PrecioLeche (lo que se paga a los ganaderos).
const precioSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  precioPorKg: { type: Number, required: true, min: 0 },
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

// ── Precio del litro de leche, por semana (viernes a jueves) ──────────────────
// Único lugar del costo del litro: lo usan las liquidaciones, Ganancias, Reportes y Precios.
const precioLecheSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  semana: { type: Number, required: true },
  anio: { type: Number, required: true },
  precioLitro: { type: Number, required: true, min: 0 }
}, { timestamps: true });
precioLecheSchema.index({ usuarioId: 1, anio: 1, semana: 1 }, { unique: true });

// ── Descuento al ganadero (se registra durante la semana y se resta en su liquidación) ──
// tipo: adelanto (plata entregada antes del pago), prestamo (cuota de un préstamo),
// leche_rechazada (litros devueltos: se descuentan a precio del litro de la semana), otro.
const descuentoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', required: true, index: true },
  fecha: { type: Date, required: true },
  tipo: { type: String, enum: ['adelanto', 'prestamo', 'leche_rechazada', 'otro'], required: true },
  valor: { type: Number, min: 0, default: 0 },
  litros: { type: Number, min: 0 },
  descripcion: { type: String }
}, { timestamps: true });

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
  dias: [{ _id: false, fecha: String, litros: Number, entregas: Number }],
  litros: { type: Number, required: true },
  precioLitro: { type: Number, required: true },
  subtotal: { type: Number, required: true },
  descuentos: [{
    _id: false,
    descuentoId: mongoose.Schema.Types.ObjectId,
    tipo: String,
    fecha: Date,
    descripcion: String,
    litros: Number,
    valor: Number
  }],
  totalDescuentos: { type: Number, default: 0 },
  total: { type: Number, required: true },
  estado: { type: String, enum: ['pendiente', 'pagado'], default: 'pendiente' },
  // Lo que se pagó. Si después se corrige la semana (con confirmación), `total` cambia y
  // la diferencia con este valor es lo que queda por ajustar con el ganadero.
  totalPagado: { type: Number },
  fechaPago: { type: Date },
  formaPago: { type: String, enum: ['efectivo', 'nequi', 'transferencia'] },
  notas: { type: String }
}, { timestamps: true });
liquidacionSchema.index({ usuarioId: 1, ganaderoId: 1, anio: 1, semana: 1 }, { unique: true });
liquidacionSchema.index({ usuarioId: 1, numero: 1 }, { unique: true });

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
  stockInicialKg: { type: Number, default: 0 },
  kgProducidos: { type: Number, default: 0 },
  kgVendidos: { type: Number, default: 0 },
  kgFinal: { type: Number, default: 0, min: 0 },
  // true cuando el usuario confirmó cuánto queso pasó a la semana siguiente
  confirmado: { type: Boolean, default: false },
  mermaKg: { type: Number, default: 0 },
  mermaPct: { type: Number, default: 0 },
  precioPorKg: { type: Number, default: 0 },
  valorMerma: { type: Number, default: 0 }
}, { timestamps: true });
cierreSemanaSchema.index({ usuarioId: 1, anio: 1, semana: 1 }, { unique: true });

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
  Descuento: mongoose.model('Descuento', descuentoSchema),
  Liquidacion: mongoose.model('Liquidacion', liquidacionSchema, 'liquidaciones'),
  Contador: mongoose.model('Contador', contadorSchema),
  CierreSemana: mongoose.model('CierreSemana', cierreSemanaSchema, 'cierres_semana')
};