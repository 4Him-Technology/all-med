import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consultaPglite, consultaPostgres, criarCnpj } from './cnpj.js'
import { createScraperClient } from './scraper.js'
import { criarVerificadorSupabase, validarConfigSupabase } from './seguranca.js'
import { createApp } from './server.js'
import { createStore } from './store.js'

const env = process.env
const dataFile = env.DATA_FILE ?? 'data/local.json'
// sem Supabase configurado, a prospecção funciona mas o envio ao kanban online fica desligado
const supabase = validarConfigSupabase({ url: env.SUPABASE_URL, chave: env.SUPABASE_PUBLISHABLE_KEY })
mkdirSync(dirname(dataFile), { recursive: true })

// Base de CNPJ: Postgres de verdade (com a migration e a carga feitas) ou, para demonstrar, dados fictícios em memória
let cnpj
if (env.CNPJ_DATABASE_URL) {
  const { default: postgres } = await import('postgres')
  cnpj = criarCnpj(consultaPostgres(postgres(env.CNPJ_DATABASE_URL, { max: 5, onnotice: () => {} })))
} else if (env.CNPJ_DEMO === '1') {
  const { criarBancoCnpj } = await import('../test/cnpj-fixture.js')
  cnpj = criarCnpj(consultaPglite(await criarBancoCnpj()))
  console.info('Base de CNPJ em modo demonstração (dados fictícios)')
}

const { server, poller } = createApp({
  store: createStore(dataFile),
  scraper: createScraperClient(env.SCRAPER_URL ?? 'http://localhost:8080'),
  cnpj,
  config: { ...supabase, urlWeb: env.WEB_URL || null, demo: Boolean(cnpj) && !env.CNPJ_DATABASE_URL },
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  log: console,
  hostsPermitidos: (env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1').split(',').map((h) => h.trim()),
  // com o CRM online ligado, a API do PC só atende quem está logado nele (vale também para o túnel)
  autenticar: supabase && criarVerificadorSupabase(supabase),
  origensWeb: (env.ORIGENS_WEB || env.WEB_URL || '')
    .split(',')
    .filter(Boolean)
    .map((u) => new URL(u.trim()).origin),
})

poller.start(Number(env.POLL_MS ?? 15_000))
const port = Number(env.PORT ?? 3000)
server.listen(port, env.HOST ?? '127.0.0.1', () => console.info(`CRM rodando em http://localhost:${port}`))
