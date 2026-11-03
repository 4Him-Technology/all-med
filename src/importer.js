import { parseCsv } from './csv.js'

export const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/
export const urlSegura = (v, max = 1000) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) && v.trim().length <= max ? v.trim() : null)

// limites iguais aos CHECKs da tabela leads no Supabase: uma linha fora do limite derrubaria o lote inteiro
const txt = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const num = (v) => {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// Converte uma linha do CSV do gosom/google-maps-scraper no formato de lead do CRM
export function rowToLead(row) {
  const nome = txt(row.title)
  if (!nome) return null
  return {
    nome,
    categoria: txt(row.category),
    endereco: txt(row.address, 500),
    telefone: txt(row.phone, 50),
    site: urlSegura(row.website, 500),
    emails: String(row.emails ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter((e) => EMAIL.test(e) && e.length <= 200)
      .slice(0, 20),
    avaliacao: num(row.review_rating),
    total_avaliacoes: num(row.review_count),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    link_maps: urlSegura(row.link),
    place_id: txt(row.place_id, 300) ?? txt(row.cid, 300) ?? txt(row.link, 300),
  }
}

// Validação antes de gravar (skill universal-scraping-architect): CSV malformado é rejeitado, linha sem nome é descartada e contada
export function parseScraperCsv(text) {
  const rows = parseCsv(text)
  if (rows.length && !('title' in rows[0])) throw new Error('CSV do scraper sem a coluna "title"')
  const leads = rows.map(rowToLead).filter(Boolean)
  return { leads, ignorados: rows.length - leads.length }
}
