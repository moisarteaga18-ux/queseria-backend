const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const usuarioSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  nombreNegocio: { type: String, default: 'Mi Quesería' },
  email: { type: String, lowercase: true },
  // Datos del perfil (opcionales)
  propietario: { type: String },
  telefono: { type: String },
  direccion: { type: String },
  nit: { type: String },
  activo: { type: Boolean, default: true },
  // Los tokens emitidos antes de esta fecha dejan de valer (al cambiar la contraseña)
  passwordCambiadoEn: { type: Date }
}, { timestamps: true });

// Antes de guardar, encripta la contraseña
usuarioSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Método para comparar contraseña al hacer login
usuarioSchema.methods.compararPassword = async function(passwordIngresado) {
  return await bcrypt.compare(passwordIngresado, this.password);
};

module.exports = mongoose.model('Usuario', usuarioSchema);