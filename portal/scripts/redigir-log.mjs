export function redigirLog(texto, segredos = []) {
  let seguro = String(texto);
  for (const segredo of [...new Set(segredos)].filter(Boolean).sort((a, b) => b.length - a.length))
    seguro = seguro.replaceAll(segredo, '[credencial removida]');
  return seguro
    .replace(/(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s"']+/gi, '$1[credencial removida]')
    .replace(/(["']?(?:[a-z_]*password|senha|api[_-]?key|[a-z_]*token|secret)["']?\s*[:=]\s*)[^\r\n,}]+/gi, '$1[credencial removida]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[credencial removida]@');
}
