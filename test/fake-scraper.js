// Imita a API REST do gosom/google-maps-scraper (modo -web) para testes e demonstração local.
// Rode com `npm run scraper:fake`; os dados gerados são fictícios.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const CABECALHO = ['input_id', 'link', 'title', 'category', 'address', 'website', 'phone', 'review_count', 'review_rating', 'latitude', 'longitude', 'cid', 'place_id', 'emails']
const campo = (v) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)

export function csvExemplo(keywords) {
  const linhas = [CABECALHO.join(',')]
  keywords.forEach((k, i) => {
    for (let n = 1; n <= 4; n++) {
      const id = `fake-${k.toLowerCase().replace(/\W+/g, '-')}-${n}`
      linhas.push(
        [
          String(i),
          `https://www.google.com/maps/place/${id}`,
          `Exemplo ${n} - ${k}`,
          'Empresa de exemplo',
          `Rua Fictícia, ${n * 100}, Centro`,
          n % 2 ? `https://exemplo-${n}.com.br` : '',
          `(11) 3000-000${n}`,
          String(n * 37),
          (3.5 + n * 0.3).toFixed(1),
          // espalhados pelo centro de São Paulo, para os pinos não ficarem um em cima do outro no mapa
          (-23.55 - n * 0.006 + i * 0.003).toFixed(5),
          (-46.63 + n * 0.005 - i * 0.004).toFixed(5),
          `cid-${id}`,
          id,
          n === 1 ? `contato@exemplo-${n}.com.br` : '',
        ]
          .map(campo)
          .join(','),
      )
    }
  })
  return `${linhas.join('\n')}\n`
}

export function createFakeScraper({ csv } = {}) {
  const jobs = new Map()
  const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'POST' && url.pathname === '/api/v1/jobs') {
      let body = ''
      for await (const chunk of req) body += chunk
      const d = JSON.parse(body || '{}')
      // mesmas regras de JobData.Validate() do projeto original
      if (!d.keywords?.length || d.lang?.length !== 2 || !d.depth || !d.max_time) {
        return json(res, 422, { code: 422, message: 'invalid job data' })
      }
      const id = randomUUID()
      jobs.set(id, { consultas: 0, keywords: d.keywords })
      return json(res, 201, { id })
    }
    const m = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)(\/download)?$/)
    const job = m && jobs.get(m[1])
    if (!job) return json(res, 404, { code: 404, message: 'not found' })
    if (m[2]) return res.writeHead(200, { 'content-type': 'text/csv' }).end(csv ?? csvExemplo(job.keywords))
    // primeira consulta devolve "working", as seguintes "ok"; campos com maiúscula como no gosom v1.18.1 (struct Job sem tag json)
    job.consultas++
    return json(res, 200, { ID: m[1], Name: 'busca', Status: job.consultas === 1 ? 'working' : 'ok', Data: { keywords: job.keywords } })
  })
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8080)
  createFakeScraper().listen(port, '127.0.0.1', () => console.info(`scraper falso em http://localhost:${port}`))
}
