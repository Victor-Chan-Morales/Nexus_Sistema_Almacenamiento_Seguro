// Paleta de la landing. Los estilos en línea mantienen la identidad sin recursos externos.
const palette = {
  brand: '#53439b', brandDeep: '#4b3c93', ice: '#e1f7fd', ink: '#191e2b',
  muted: '#687083', line: '#e5e7ef', canvas: '#f6f7fb',
};

interface NexusEmail {
  heading: string;
  greeting?: string;
  message: string;
  action?: { label: string; url: string; detail: string };
  note?: string;
}

export function renderNexusEmail({ heading, greeting, message, action, note }: NexusEmail): string {
  const button = action ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><td align="center" bgcolor="${palette.brand}" style="background-color:${palette.brand};border-radius:12px;mso-padding-alt:14px 20px;">
        <a href="${escapeHtml(action.url)}" style="display:block;padding:14px 20px;color:#ffffff;font-size:16px;line-height:24px;font-weight:700;text-decoration:none;border-radius:12px;">${escapeHtml(action.label)}</a>
      </td></tr>
    </table>
    <p style="margin:12px 0 0;color:${palette.muted};font-size:13px;line-height:20px;">${escapeHtml(action.detail)}</p>` : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${palette.canvas};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${palette.canvas}" style="background-color:${palette.canvas};font-family:Arial,Helvetica,sans-serif;">
    <tr><td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="560" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="max-width:560px;background-color:#ffffff;border:1px solid ${palette.line};border-radius:16px;">
        <tr><td bgcolor="${palette.ice}" style="background-color:${palette.ice};padding:18px 24px;border-top:4px solid ${palette.brand};border-radius:15px 15px 0 0;color:${palette.brandDeep};font-size:22px;line-height:28px;font-weight:800;">Nexus</td></tr>
        <tr><td style="padding:28px 24px 30px;color:${palette.ink};">
          <h1 style="margin:0 0 16px;font-size:28px;line-height:34px;font-weight:700;color:${palette.ink};">${escapeHtml(heading)}</h1>
          ${greeting ? `<p style="margin:0 0 8px;font-size:16px;line-height:25px;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(greeting)}</p>` : ''}
          <p style="margin:0${action ? ' 0 24px' : ''};font-size:16px;line-height:25px;">${escapeHtml(message)}</p>
          ${button}
          ${note ? `<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid ${palette.line};color:${palette.muted};font-size:13px;line-height:20px;">${escapeHtml(note)}</p>` : ''}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;color:${palette.muted};font-size:12px;line-height:18px;">Nexus · Almacenamiento seguro</p>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
