// Build do site na web (Netlify ou Cloudflare Pages): gera public/config.js com a chave pública do Supabase
// e public/_headers com os cabeçalhos de segurança. Comando de build: node scripts/gerar-config.js
// Pasta publicada: public. Variáveis no painel do host: SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY,
// e PC_URL (opcional) com o endereço do túnel até o PC, que liga as abas Prospecção e Google Maps no site.
import { writeFileSync } from 'node:fs'
import { cabecalhosSeguranca, validarConfigSupabase, validarUrlPc } from '../src/seguranca.js'

let config
let urlPc
try {
  config = validarConfigSupabase({ url: process.env.SUPABASE_URL, chave: process.env.SUPABASE_PUBLISHABLE_KEY })
  if (!config) throw new Error('Defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY antes do build.')
  urlPc = validarUrlPc(process.env.PC_URL)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

const publico = new URL('../public/', import.meta.url)
writeFileSync(new URL('config.js', publico), `export default ${JSON.stringify({ ...config, local: false, urlPc })}\n`)

const cabecalhos = {
  ...cabecalhosSeguranca(config.supabaseUrl, urlPc),
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}
writeFileSync(new URL('_headers', publico), `/*\n${Object.entries(cabecalhos).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n`)
console.info(`config.js e _headers gerados para ${config.supabaseUrl}${urlPc ? `, com o PC em ${urlPc}` : ', sem o PC'}`)
