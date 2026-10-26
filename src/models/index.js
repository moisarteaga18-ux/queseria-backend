const mongoose = require('mongoose');
const { librasPorLata } = require('../utils/unidades');

/**
 * Número decimal: se guarda SIEMPRE como double en MongoDB (con Number, los valores sin decimales
 * quedaban como int y Atlas mostraba el campo con tipo mixto) y en el código se lee como número.
 * [min]: el tipo Double no aplica la regla min de Mongoose, por eso va como validador.
 */
function decimal({ min, ...resto } = {}) {
  return {
    type: mongoose.Schema.Types.Double,
    get: (v) => (v == null ? v : Number(v)),
    ...(min !== undefined && {
      validate: { validator: (v) => v == null || Number(v) >= min, message: '{PATH} no puede ser menor que ' + min }
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
  litros: decimal({ required: true, min: 0 }),
  // El nombre se toma siempre del ganadero (el campo viejo `proveedor` se migró y eliminó)
  ganaderoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ganadero', required: true, index: true },
  observaciones: { type: String }
}, opciones);

// ── Producción de queso ──────────────────────────────────────────────────────
const produccionSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  fecha: { type: Date, required: true, default: Date.now },
  litrosUsados: decimal({ required: true }),
  kgProducidos: decimal({ required: true }),
  // Libras de queso por lata (ver pre('save'))
  rendimiento: decimal(),
  // Producto al que se sumó el queso en el inventario (opcional)
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
  observaciones: { type: String }
}, opciones);

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
  precioPorKg: decimal({ required: true, min: 0 }),
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
  cantidad: decimal({ required: true, min: 0 }),
  unidad: { type: String, enum: ['kg', 'libras'], required: true },
  precioUnitario: decimal({ required: true }),
  totalVenta: decimal({ required: true }),
  precioRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Precio' }
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
  precioLitro: decimal({ required: true, min: 0 })
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
  LiquidacionAnulada: mongoose.model('LiquidacionAnulada', liquidacionAnuladaSchema, 'liquidaciones_anuladas'),
  Contador: mongoose.model('Contador', contadorSchema),
  CierreSemana: mongoose.model('CierreSemana', cierreSemanaSchema, 'cierres_semana')
};