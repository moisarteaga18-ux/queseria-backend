// Semanas ISO (lunes a domingo) calculadas en UTC.
// La app envía las fechas como "yyyy-MM-dd", que se guardan como medianoche UTC,
// así que calcular en UTC evita que un registro caiga en la semana equivocada.

const DIA_MS = 24 * 60 * 60 * 1000;

/** Lunes 00:00 UTC de la semana ISO indicada. */
function lunesDeSemana(semana, anio) {
  const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
  const diaSemana = cuatroEnero.getUTCDay() || 7;
  return new Date(cuatroEnero.getTime() + ((semana - 1) * 7 - (diaSemana - 1)) * DIA_MS);
}

/** { inicio: lunes 00:00, fin: domingo 23:59:59.999 } en UTC. */
function rangoSemana(semana, anio) {
  const inicio = lunesDeSemana(semana, anio);
  return { inicio, fin: new Date(inicio.getTime() + 7 * DIA_MS - 1) };
}

/** Semana ISO ({ semana, anio }) a la que pertenece una fecha (en UTC). */
function semanaDeFecha(fecha) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const diaSemana = d.getUTCDay() || 7;
  // El jueves de esa semana define el año ISO
  const jueves = new Date(d.getTime() + (4 - diaSemana) * DIA_MS);
  const anio = jueves.getUTCFullYear();
  const semana = Math.floor((jueves - Date.UTC(anio, 0, 1)) / DIA_MS / 7) + 1;
  return { semana, anio };
}

/** Lee ?semana=&anio= de la petición; si faltan, usa la semana de hoy (o de ?fecha=). */
function semanaDeQuery(query) {
  const semana = Number(query.semana);
  const anio = Number(query.anio);
  if (semana >= 1 && semana <= 53 && anio > 2000) return { semana, anio };
  return semanaDeFecha(query.fecha ? new Date(query.fecha) : new Date());
}

module.exports = { lunesDeSemana, rangoSemana, semanaDeFecha, semanaDeQuery };
