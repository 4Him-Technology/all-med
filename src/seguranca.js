// Cabeçalhos de segurança e checagem da configuração do Supabase, usados pelo servidor local e pelo build do site

// urlPc: no site da internet, o endereço do túnel que leva às abas Prospecção e Google Maps do PC
export function cabecalhosSeguranca(supabaseUrl, urlPc) {
  const supa = supabaseUrl ? new URL(supabaseUrl) : null
  const conectar = `${supa ? ` ${supa.origin} wss://${supa.host}` : ''}${urlPc ? ` ${new URL(urlPc).origin}` : ''}`
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

export function validarUrlPc(url) {
  if (!url) return null
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error('PC_URL deve começar com https://')
  return u.origin
}

const FORMATO_JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/

// Confere o token do login no próprio Auth do Supabase (a mesma conta do CRM) e lê as telas que a pessoa abre
// (public.minhas_telas). Guarda a resposta por 1 minuto para não consultar a cada chamada; um token revogado ou uma
// tela tirada pelo administrador valem no máximo até lá.
export function criarVerificadorSupabase({ supabaseUrl, supabaseKey, fetchImpl = globalThis.fetch, validadeMs = 60_000 }) {
  const cache = new Map()
  return async (token) => {
    if (typeof token !== 'string' || token.length > 4096 || !FORMATO_JWT.test(token)) return null
    const guardado = cache.get(token)
    if (guardado && guardado.expira > Date.now()) return guardado.usuario
    const pedir = (caminho) => fetchImpl(new URL(caminho, supabaseUrl), { headers: { apikey: supabaseKey, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
    const [res, resTelas] = await Promise.all([pedir('/auth/v1/user'), pedir('/rest/v1/rpc/minhas_telas')])
    // login bom sem a lista de telas não libera nada nem fica guardado: a próxima chamada tenta de novo
    if (res.ok && !resTelas.ok) throw new Error(`minhas_telas respondeu ${resTelas.status}`)
    const usuario = res.ok ? { id: (await res.json()).id, telas: await resTelas.json() } : null
    // tokens inventados em série não enchem a memória: passou do teto, o cache recomeça
    if (cache.size >= 1000) cache.clear()
    cache.set(token, { usuario, expira: Date.now() + validadeMs })
    return usuario
  }
}
