// Envío de correos con la API HTTPS de Brevo (Render gratis bloquea los puertos SMTP).
// Variables de entorno (en Render → Environment):
//   BREVO_API_KEY  clave de API de Brevo (empieza por "xkeysib-")
//   CORREO_DE      correo remitente verificado en Brevo (Senders), p. ej. tucorreo@gmail.com
//   CORREO_NOMBRE  nombre que ve quien recibe (por defecto "QuesoData")
// Solo para pruebas locales: CORREO_ARCHIVO = archivo donde se anotan los correos en lugar de
// enviarlos (una línea JSON por correo), y BREVO_URL para apuntar a un servidor falso.

const fs = require('fs');

const BREVO_URL = process.env.BREVO_URL || 'https://api.brevo.com/v3/smtp/email';

function configurado() {
  return !!process.env.CORREO_ARCHIVO || !!(process.env.BREVO_API_KEY && process.env.CORREO_DE);
}

/** Envía un correo de texto (con versión HTML opcional). Lanza error si Brevo no lo acepta. */
async function enviarCorreo({ para, asunto, texto, html }) {
  if (process.env.CORREO_ARCHIVO) {
    fs.appendFileSync(process.env.CORREO_ARCHIVO, JSON.stringify({ para, asunto, texto, fecha: new Date() }) + '\n');
    return;
  }
  const respuesta = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { name: process.env.CORREO_NOMBRE || 'QuesoData', email: process.env.CORREO_DE },
      to: [{ email: para }],
      subject: asunto,
      textContent: texto,
      ...(html ? { htmlContent: html } : {})
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!respuesta.ok) {
    // Brevo explica el motivo (clave inválida, remitente sin verificar, IP no autorizada…)
    const detalle = await respuesta.text().catch(() => '');
    throw new Error(`Brevo respondió ${respuesta.status}: ${detalle.slice(0, 300)}`);
  }
}

module.exports = { configurado, enviarCorreo };
