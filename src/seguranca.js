// Cabeçalhos de segurança e checagem da configuração do Supabase, usados pelo servidor local e pelo build do site

export function cabecalhosSeguranca(supabaseUrl) {
  const supa = supabaseUrl ? new URL(supabaseUrl) : null
  const conectar = supa ? ` ${supa.origin} wss://${supa.host}` : ''
  return {
    // fonte Montserrat vem do Google Fonts: CSS de fonts.googleapis.com, arquivos de fonts.gstatic.com
    // mapa do Google Maps: Leaflet (JS e CSS com versão fixa e SRI) no jsDelivr, tiles do OpenStreetMap
    'content-security-policy': `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com; connect-src 'self'${conectar}; img-src 'self' data: https://tile.openstreetmap.org; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  }
}

const papelJwt = (chave) => {
  try {
    return JSON.parse(Buffer.from(chave.split('.')[1], 'base64url').toString()).role
  } catch {
    return null
  }
}

// A chave que vai para o navegador tem de ser a pública. A secreta (ou a service_role antiga) passa por cima da RLS.
export function validarConfigSupabase({ url, chave }) {
  if (!url && !chave) return null
  if (!url || !chave) throw new Error('Defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY juntos')
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error('SUPABASE_URL deve começar com https://')
  if (chave.startsWith('sb_secret_') || papelJwt(chave) === 'service_role') {
    throw new Error('SUPABASE_PUBLISHABLE_KEY recebeu a chave secreta. Use a chave pública (publishable ou anon).')
  }
  return { supabaseUrl: u.origin, supabaseKey: chave }
}
