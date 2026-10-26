const router = require('express').Router();
const { Produccion } = require('../models');
const { semanaDeFecha, rangoSemana, textoRango, iso } = require('../utils/semana');

const { LIBRAS_POR_KG, LITROS_POR_LATA } = require('../utils/unidades');
const redondear = (n) => parseFloat(n.toFixed(2));

// GET /api/rendimiento/semanal — libras de queso por lata, por semana (viernes a jueves)
router.get('/semanal', async (req, res) => {
  try {
    const producciones = await Produccion.find({ usuarioId: req.usuarioId })
      .select('fecha litrosUsados kgProducidos').lean();

    // Agrupar por semana viernes–jueves (en JS: Mongo solo sabe agrupar por semana ISO)
    const grupos = new Map();
    for (const p of producciones) {
      const { semana, anio } = semanaDeFecha(new Date(p.fecha));
      const clave = `${anio}-${semana}`;
      const g = grupos.get(clave) || { _id: { semana, anio }, totalLitros: 0, totalKg: 0 };
      g.totalLitros += p.litrosUsados || 0;
      g.totalKg += p.kgProducidos || 0;
      grupos.set(clave, g);
    }

    const semanas = [...grupos.values()]
      .sort((a, b) => (b._id.anio - a._id.anio) || (b._id.semana - a._id.semana))
      .slice(0, 12)
      .map(g => {
        const totalLatas = g.totalLitros / LITROS_POR_LATA;
        const totalLibras = g.totalKg * LIBRAS_POR_KG;
        const { inicio, fin } = rangoSemana(g._id.semana, g._id.anio);
        const texto = textoRango(inicio, fin);
        return {
          ...g,
          totalLatas,
          totalLibras,
          librasPorLata: totalLatas > 0 ? redondear(totalLibras / totalLatas) : 0,
          kgPorLata: totalLatas > 0 ? redondear(g.totalKg / totalLatas) : 0,
          rango: { inicio: iso(inicio), fin: iso(fin), texto },
          etiqueta: `Sem ${g._id.semana} · ${texto}`
        };
      });

    const promedio = semanas.length > 0
      ? redondear(semanas.reduce((s, d) => s + d.librasPorLata, 0) / semanas.length)
      : 0;

    res.json({
      ok: true,
      data: {
        semanas,
        promedioLibrasPorLata: promedio,
        mejorSemana: semanas.reduce((b, d) => d.librasPorLata > (b?.librasPorLata || 0) ? d : b, null),
        peorSemana: semanas.reduce((w, d) => d.librasPorLata < (w?.librasPorLata ?? Infinity) ? d : w, null)
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
