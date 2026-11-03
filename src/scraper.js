// Cliente da API REST do gosom/google-maps-scraper rodando em modo web (-web, porta 8080 por padrão)
import { parseScraperCsv } from './importer.js'

export function createScraperClient(baseUrl, fetchImpl = globalThis.fetch) {
  const call = async (path, init = {}) => {
    const res = await fetchImpl(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`scraper respondeu ${res.status} em ${path}: ${(await res.text()).slice(0, 200)}`)
    return res
  }
  return {
    async criarJob(b) {
      const res = await call('/api/v1/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: b.nome, keywords: b.keywords, lang: b.lang, depth: b.depth, email: b.email, zoom: 15, max_time: b.max_minutos * 60 }),
      })
      return (await res.json()).id
    },
    async statusJob(id) {
      // o gosom devolve o Job sem tag json: o campo vem como "Status", com maiúscula
      return (await (await call(`/api/v1/jobs/${encodeURIComponent(id)}`)).json()).Status
    },
    async baixarCsv(id) {
      return (await call(`/api/v1/jobs/${encodeURIComponent(id)}/download`)).text()
    },
  }
}

const STATUS_JOB = { pending: 'pendente', working: 'executando', failed: 'falhou' }

// Acompanha as buscas abertas; quando o job termina, baixa o CSV e guarda os leads para a tela enviar ao kanban online
export function createPoller({ store, scraper, log }) {
  let rodando = false
  async function tick() {
    if (rodando) return
    rodando = true
    try {
      for (const b of store.buscasAtivas()) {
        try {
          const st = await scraper.statusJob(b.scraper_job_id)
          if (st === 'ok') {
            const csv = await scraper.baixarCsv(b.scraper_job_id)
            let lote
            try {
              lote = parseScraperCsv(csv)
            } catch (err) {
              // CSV malformado não melhora tentando de novo
              store.updateBusca(b.id, { status: 'falhou', erro: err.message })
              log.error(`busca ${b.id}: ${err.message}`)
              continue
            }
            store.updateBusca(b.id, { status: 'importado', leads: lote.leads, encontrados: lote.leads.length, ignorados: lote.ignorados, erro: null })
            log.info(`busca ${b.id}: ${lote.leads.length} encontrados, ${lote.ignorados} ignorados`)
          } else if (STATUS_JOB[st] && STATUS_JOB[st] !== b.status) {
            store.updateBusca(b.id, { status: STATUS_JOB[st], erro: st === 'failed' ? 'o scraper marcou o job como falho' : null })
          }
        } catch (err) {
          // erro de rede é transitório: guarda a mensagem e tenta no próximo ciclo
          log.error(`busca ${b.id}: ${err.message}`)
          store.updateBusca(b.id, { erro: err.message.slice(0, 300) })
        }
      }
    } finally {
      rodando = false
    }
  }
  return {
    tick,
    start(ms) {
      const t = setInterval(tick, ms)
      t.unref()
      return () => clearInterval(t)
    },
  }
}
