// Semanas de la quesería: de VIERNES a JUEVES (el jueves es el día de corte), calculadas en UTC.
// La app envía las fechas como "yyyy-MM-dd", que se guardan como medianoche UTC,
// así que calcular en UTC evita que un registro caiga en la semana equivocada.
//
// Cada semana se identifica con { semana, anio } = semana ISO de su jueves de corte.
// Como cada semana viernes–jueves tiene exactamente un jueves, la clave es única.

const DIA_MS = 24 * 60 * 60 * 1000;
const JUEVES = 4; // getUTCDay(): 0 = domingo ... 4 = jueves, 5 = viernes

function soloDia(fecha) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/** Semana ISO ({ semana, anio }) de un jueves. */
function semanaIsoDeJueves(jueves) {
  const anio = jueves.getUTCFullYear();
  const semana = Math.floor((jueves - Date.UTC(anio, 0, 1)) / DIA_MS / 7) + 1;
  return { semana, anio };
}

/** Jueves (00:00 UTC) de la semana ISO indicada: el día de corte de esa semana. */
function juevesDeSemana(semana, anio) {
  const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
  const diaSemana = cuatroEnero.getUTCDay() || 7;
  const lunes = cuatroEnero.getTime() + ((semana - 1) * 7 - (diaSemana - 1)) * DIA_MS;
  return new Date(lunes + 3 * DIA_MS);
}

/** { inicio: viernes 00:00, fin: jueves 23:59:59.999 } en UTC. */
function rangoSemana(semana, anio) {
  const jueves = juevesDeSemana(semana, anio);
  return {
    inicio: new Date(jueves.getTime() - 6 * DIA_MS),
    fin: new Date(jueves.getTime() + DIA_MS - 1)
  };
}

/** Semana ({ semana, anio }) a la que pertenece una fecha: la del primer jueves en o después de ella. */
function semanaDeFecha(fecha) {
  const d = soloDia(fecha);
  const hastaJueves = (JUEVES - d.getUTCDay() + 7) % 7;
  return semanaIsoDeJueves(new Date(d.getTime() + hastaJueves * DIA_MS));
}

/** Lee ?semana=&anio= de la petición; si faltan, usa la semana de hoy (o de ?fecha=). */
function semanaDeQuery(query) {
  const semana = Number(query.semana);
  const anio = Number(query.anio);
  if (semana >= 1 && semana <= 53 && anio > 2000) return { semana, anio };
  return semanaDeFecha(query.fecha ? new Date(query.fecha) : new Date());
}

/** La semana anterior a la indicada. */
function semanaAnterior(semana, anio) {
  return semanaDeFecha(new Date(rangoSemana(semana, anio).inicio.getTime() - DIA_MS));
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "17 – 23 oct 2026" o "31 oct – 6 nov 2026". */
function textoRango(inicio, fin) {
  const fmt = (f, anio) => `${f.getUTCDate()} ${MESES[f.getUTCMonth()]}${anio ? ' ' + f.getUTCFullYear() : ''}`;
  if (inicio.getUTCMonth() === fin.getUTCMonth()) return `${inicio.getUTCDate()} – ${fmt(fin, true)}`;
  return `${fmt(inicio, inicio.getUTCFullYear() !== fin.getUTCFullYear())} – ${fmt(fin, true)}`;
}

/** "yyyy-MM-dd" de una fecha UTC. */
function iso(fecha) {
  return fecha.toISOString().slice(0, 10);
}

module.exports = {
  DIA_MS, rangoSemana, semanaDeFecha, semanaDeQuery, semanaAnterior, textoRango, iso
};
