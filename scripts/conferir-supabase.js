// Confere, de fora e só com a chave pública, se a migration do CRM está aplicada e fechada para quem não fez login.
// Uso: node --env-file=.env scripts/conferir-supabase.js
import { validarConfigSupabase } from '../src/seguranca.js'

let cfg
try {
  cfg = validarConfigSupabase({ url: process.env.SUPABASE_URL, chave: process.env.SUPABASE_PUBLISHABLE_KEY })
  if (!cfg) throw new Error('Defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no .env')
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

const chamar = async (caminho, init = {}) => {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: cfg.supabaseKey, 'content-type': 'application/json', ...init.headers },
  })
  const corpo = await res.json().catch(() => ({}))
  return { status: res.status, code: corpo.code, message: corpo.message }
}

// visitante sem login: tabela existe (senão viria PGRST205) e o acesso é negado (42501)
const checagens = [
  ['ler leads', () => chamar('leads?select=id&limit=1'), '42501'],
  ['ler kanban', () => chamar('leads_kanban?select=id&limit=1'), '42501'],
  ['ler atendimentos', () => chamar('atendimentos?select=id&limit=1'), '42501'],
  ['criar lead', () => chamar('leads', { method: 'POST', body: JSON.stringify({ nome: 'teste anônimo' }) }), '42501'],
  // funções internas (esquema crm) não podem aparecer na API
  ['chamar função interna', () => chamar('rpc/emails_validos', { method: 'POST', body: JSON.stringify({ lista: [] }) }), 'PGRST202'],
]

let falhas = 0
for (const [nome, fazer, esperado] of checagens) {
  const r = await fazer()
  const ok = r.code === esperado
  if (!ok) falhas++
  const dica = r.code === 'PGRST205' ? ' (tabela não existe: a migration foi aplicada?)' : ''
  console.info(`${ok ? 'ok   ' : 'FALHA'} visitante ${nome}: ${r.status} ${r.code ?? ''}${dica}`)
}
console.info(falhas ? `${falhas} checagem(ns) falharam.` : 'Tudo certo: as tabelas existem e estão fechadas para quem não fez login.')
process.exitCode = falhas ? 1 : 0
