// Cliente do Supabase com a chave pública. A segurança dos dados fica na RLS do banco, não aqui.
// config.js vem do servidor local (a partir do .env) ou do build do site (scripts/gerar-config.js)
import config from '/config.js'

export { config }

const configurado = Boolean(config.supabaseUrl && config.supabaseKey)
// só baixa o supabase-js quando há projeto configurado; versão fixa para o CDN não trocar o código por baixo
const { createClient } = configurado ? await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm') : {}

// shortcut: a sessão fica no sessionStorage (some ao fechar a aba) e não em cookie HttpOnly,
// porque o site é estático; cookie HttpOnly pede uma função no servidor intermediando o login (ver README)
export const supabase = configurado
  ? createClient(config.supabaseUrl, config.supabaseKey, { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true } })
  : null
