const router = require('express').Router();
const { Produccion } = require('../models');

// Dado un número de semana ISO y año, devuelve el lunes y domingo exactos
function rangoSemanaISO(semana, anio) {
  // El 4 de enero siempre cae en la semana 1 ISO
  const cuatroEnero = new Date(anio, 0, 4);
  const diaSemana = cuatroEnero.getDay() || 7; // lunes=1 ... domingo=7
  const lunes = new Date(cuatroEnero);
  lunes.setDate(cuatroEnero.getDate() - (diaSemana - 1) + (semana - 1) * 7);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return { lunes, domingo };
}

// Formatea fecha como "27 abr" o "3 may 2026"
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function fmt(fecha, conAnio = false) {
  const d = fecha.getDate();
  const m = MESES[fecha.getMonth()];
  const a = fecha.getFullYear();
  return conAnio ? `${d} ${m} ${a}` : `${d} ${m}`;
}

// GET /api/rendimiento/semanal  → libras por lata por semana con rango de fechas
router.get('/semanal', async (req, res) => {
  try {
    const datos = await Produccion.aggregate([
      {
        $group: {
          _id: {
            semana: { $isoWeek: '$fecha' },
            anio: { $isoWeekYear: '$fecha' }
          },
          totalLitros: { $sum: '$litrosUsados' },
          totalKg: { $sum: '$kgProducidos' },
          // Guardamos la fecha mínima y máxima real de registros de esa semana
          fechaMin: { $min: '$fecha' },
          fechaMax: { $max: '$fecha' }
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
          librasPorLata: {
            $round: [{ $divide: ['$totalLibras', '$totalLatas'] }, 2]
          },
          kgPorLata: {
            $round: [{ $divide: ['$totalKg', '$totalLatas'] }, 2]
          }
        }
      },
      { $sort: { '_id.anio': -1, '_id.semana': -1 } },
      { $limit: 12 }
    ]);

    // Enriquecer cada semana con el rango de fechas legible
    const semanas = datos.map(d => {
      const { lunes, domingo } = rangoSemanaISO(d._id.semana, d._id.anio);
      // Si lunes y domingo son del mismo mes: "27 abr – 3 may 2026"
      // Si son del mismo mes: "1 – 7 abr 2026"
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
          texto: rangoTexto   // ej: "27 abr – 3 may 2026"
        },
        etiqueta: `Sem ${d._id.semana} · ${rangoTexto}`  // ej: "Sem 18 · 27 abr – 3 may 2026"
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

// GET /api/rendimiento/hoy → libras por lata del día de hoy
router.get('/hoy', async (req, res) => {
  try {
    const hoy = new Date();
    const inicio = new Date(hoy.setHours(0, 0, 0, 0));
    const fin = new Date(hoy.setHours(23, 59, 59, 999));

    const result = await Produccion.aggregate([
      { $match: { fecha: { $gte: inicio, $lte: fin } } },
      {
        $group: {
          _id: null,
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
          librasPorLata: {
            $round: [{ $divide: ['$totalLibras', '$totalLatas'] }, 2]
          },
          kgPorLata: {
            $round: [{ $divide: ['$totalKg', '$totalLatas'] }, 2]
          }
        }
      }
    ]);

    if (!result.length) {
      return res.json({ ok: true, data: null, mensaje: 'Sin producción registrada hoy' });
    }

    res.json({ ok: true, data: result[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
