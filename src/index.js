require('dotenv').config();
require('./config'); // Sale con error si falta JWT_SECRET (antes de aceptar peticiones)
const mongoose = require('mongoose');
const app = require('./app');

// Conexión a MongoDB (MONGODB_URI) y arranque del servidor
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    const { host, name } = mongoose.connection;
    console.log(`✅ Conectado a MongoDB (${host}, base "${name}")`);
    app.listen(process.env.PORT || 3000, () => {
      console.log(`🚀 Servidor corriendo en puerto ${process.env.PORT || 3000}`);
    });
  })
  .catch(err => {
    console.error('❌ Error conectando a MongoDB:', err.message);
    process.exit(1);
  });
