const router = require('express').Router();
const { Produccion } = require('../models');
const ObjectId = require('mongoose').Types.ObjectId;

function rangoSemanaISO(semana, anio) {
  const cuatroEnero = new Date(anio, 0, 4);
  const diaSemana = cuatroEnero.getDay() || 7;
  const lunes = new Date(cuatroEnero);
  lunes.setDate(cuatroEnero.getDate() - (diaSemana - 1) + (semana - 1) * 7);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return { lunes, domingo };
}

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function fmt(fecha, conAnio = false) {
  const d = fecha.getDate();
  const m = MESES[fecha.getMonth()];
  const a = fecha.getFullYear();
  return conAnio ? `${d} ${m} ${a}` : `${d} ${m}`;
}

// GET /api/rendimiento/semanal
router.get('/semanal', async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    const datos = await Produccion.aggregate([
      { $match: { usuarioId: new ObjectId(usuarioId) } },
      {
        $group: {
          _id: { semana: { $isoWeek: '$fecha' }, anio: { $isoWeekYear: '$fecha' } },
          totalLitros: { $sum: '$litrosUsados' },
          totalKg: { $sum: '$kgProducidos' }
        }
      },
      {
        $addFields: {
          totalLatas: { $divide: ['$totalLitros', 20] },
          totalLibras: { $multiply: ['$totalKg', 2.2046] }
        }
      },
      {
        $addFields: {
          librasPorLata: { $round: [{ $divide: ['$totalLibras', '$totalLatas'] }, 2] },
          kgPorLata: { $round: [{ $divide: ['$totalKg', '$totalLatas'] }, 2] }
        }
      },
      { $sort: { '_id.anio': -1, '_id.semana': -1 } },
      { $limit: 12 }
    ]);

    const semanas = datos.map(d => {
      const { lunes, domingo } = rangoSemanaISO(d._id.semana, d._id.anio);
      let rangoTexto;
      if (lunes.getMonth() === domingo.getMonth()) {
        rangoTexto = `${lunes.getDate()} – ${fmt(domingo, true)}`;
      } else {
        rangoTexto = `${fmt(lunes)} – ${fmt(domingo, true)}`;
      }
      return {
        ...d,
        rango: {
          lunes: lunes.toISOString().split('T')[0],
          domingo: domingo.toISOString().split('T')[0],
          texto: rangoTexto
        },
        etiqueta: `Sem ${d._id.semana} · ${rangoTexto}`
      };
    });

    const promedio = semanas.length > 0
      ? parseFloat((semanas.reduce((s, d) => s + d.librasPorLata, 0) / semanas.length).toFixed(2))
      : 0;

    res.json({
      ok: true,
      data: {
        semanas,
        promedioLibrasPorLata: promedio,
        mejorSemana: semanas.reduce((b, d) => d.librasPorLata > (b?.librasPorLata || 0) ? d : b, null),
        peorSemana: semanas.reduce((w, d) => d.librasPorLata < (w?.librasPorLata || 999) ? d : w, null)
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
