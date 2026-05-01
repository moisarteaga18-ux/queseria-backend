require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/leche', require('./routes/leche'));
app.use('/api/produccion', require('./routes/produccion'));
app.use('/api/ventas', require('./routes/ventas'));
app.use('/api/precios', require('./routes/precios'));
app.use('/api/resumen', require('./routes/resumen'));

// Conexión MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Conectado a MongoDB Atlas');
    app.listen(process.env.PORT || 3000, () => {
      console.log(`🚀 Servidor corriendo en puerto ${process.env.PORT || 3000}`);
    });
  })
  .catch(err => {
    console.error('❌ Error conectando a MongoDB:', err.message);
    process.exit(1);
  });
