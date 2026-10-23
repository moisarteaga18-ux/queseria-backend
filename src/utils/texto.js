/** Expresión que compara un nombre completo sin distinguir mayúsculas ("Queso Costeño" = "queso costeño"). */
function nombreIgual(nombre) {
  const escapado = String(nombre).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapado}$`, 'i');
}

/** Devuelve el texto sin espacios sobrantes, o undefined si queda vacío. */
function textoOpcional(valor) {
  if (valor === undefined || valor === null) return undefined;
  const t = String(valor).trim();
  return t.length ? t : undefined;
}

module.exports = { nombreIgual, textoOpcional };
