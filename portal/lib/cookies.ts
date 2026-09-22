export function parseCookies(request: Request): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null);
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    try {
      const name = decodeURIComponent(part.slice(0, separator).trim());
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      if (name) cookies[name] = value;
    } catch { /* Um cookie inválido não invalida os demais. */ }
  }
  return cookies;
}
