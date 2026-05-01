const router = require('express').Router();
const { Produccion } = require('../models');

// POST /api/produccion
// Body: { fecha, litrosRecibidos, kgPesados, observaciones }
// Tú ingresas litros del día + kg que pesó el queso → app calcula todo
router.post('/', async (req, res) => {
  try {
    const { fecha, litrosRecibidos, kgPesados, observaciones } = req.body;

    if (!litrosRecibidos || litrosRecibidos <= 0)
      return res.status(400).json({ ok: false, error: 'Ingresa los litros recibidos' });
    if (!kgPesados || kgPesados <= 0)
      return res.status(400).json({ ok: false, error: 'Ingresa los kg que pesó el queso' });

    // Cálculos automáticos
    const latasDelDia   = litrosRecibidos / 20;
    const librasTotales = parseFloat((kgPesados * 2.2046).toFixed(2));
    const librasPorLata = parseFloat((librasTotales / latasDelDia).toFixed(2));
    const kgPorLata     = parseFloat((kgPesados / latasDelDia).toFixed(2));

    const registro = await Produccion.create({
      fecha:        fecha ? new Date(fecha) : new Date(),
      litrosUsados: litrosRecibidos,
      kgProducidos: kgPesados,
      latasDelDia,
      librasTotales,
      librasPorLata,
      kgPorLata,
      observaciones
    });

    res.status(201).json({
      ok: true,
      data: registro,
      resumen: {
        mensaje:      `${latasDelDia.toFixed(1)} latas → ${librasPorLata} lb por lata`,
        librasPorLata,
        kgPorLata,
        librasTotales
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/produccion → historial diario
router.get('/', async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    const registros = await Produccion.find()
      .sort({ fecha: -1 })
      .limit(Number(limit));
    res.json({ ok: true, data: registros });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/produccion/semanal → promedio libras por lata por semana
router.get('/semanal', async (req, res) => {
  try {
    const semanas = await Produccion.aggregate([
      {
        $group: {
          _id: { semana: { $isoWeek: '$fecha' }, anio: { $isoWeekYear: '$fecha' } },
          totalLitros:          { $sum: '$litrosUsados' },
          totalKg:              { $sum: '$kgProducidos' },
          totalLibras:          { $sum: '$librasTotales' },
          diasRegistrados:      { $sum: 1 },
          promedioLibrasPorLata:{ $avg: '$librasPorLata' },
          mejorDia:             { $max: '$librasPorLata' },
          peorDia:              { $min: '$librasPorLata' }
        }
      },
      {
        $addFields: {
          totalLatas:            { $divide: ['$totalLitros', 20] },
          promedioLibrasPorLata: { $round: ['$promedioLibrasPorLata', 2] },
          mejorDia:              { $round: ['$mejorDia', 2] },
          peorDia:               { $round: ['$peorDia', 2] }
        }
      },
      { $sort: { '_id.anio': -1, '_id.semana': -1 } },
      { $limit: 12 }
    ]);

    const promedioHistorico = semanas.length > 0
      ? parseFloat((semanas.reduce((s, sem) => s + sem.promedioLibrasPorLata, 0) / semanas.length).toFixed(2))
      : 0;

    res.json({
      ok: true,
      data: {
        semanas,
        promedioHistorico,
        mejorSemana: semanas.reduce((b, s) => s.promedioLibrasPorLata > (b?.promedioLibrasPorLata || 0) ? s : b, null),
        peorSemana:  semanas.reduce((w, s) => s.promedioLibrasPorLata < (w?.promedioLibrasPorLata || 999) ? s : w, null)
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Produccion.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
