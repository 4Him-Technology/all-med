// Estado local do PC: as buscas no Google Maps e os resultados delas, até serem enviados ao CRM online (Supabase).
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const objeto = (v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ValidationError('Corpo da requisição deve ser um objeto')
  return v
}
const texto = (v, campo, max) => {
  if (v == null || v === '') return null
  if (typeof v !== 'string') throw new ValidationError(`${campo} deve ser texto`)
  const t = v.trim()
  if (t.length > max) throw new ValidationError(`${campo} passa de ${max} caracteres`)
  return t || null
}
const inteiro = (v, campo, min, max, padrao) => {
  if (v == null || v === '') return padrao
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${campo} deve estar entre ${min} e ${max}`)
  return n
}

export function validarBusca(input) {
  objeto(input)
  const keywords = (Array.isArray(input.keywords) ? input.keywords : String(input.keywords ?? '').split('\n')).map((k) => String(k).trim()).filter(Boolean)
  if (!keywords.length) throw new ValidationError('informe ao menos um termo de busca')
  if (keywords.length > 50) throw new ValidationError('no máximo 50 termos por busca')
  if (keywords.some((k) => k.length > 200)) throw new ValidationError('termo de busca passa de 200 caracteres')
  const lang = input.lang == null || input.lang === '' ? 'pt' : String(input.lang).toLowerCase()
  if (!/^[a-z]{2}$/.test(lang)) throw new ValidationError('idioma deve ter 2 letras, ex.: pt')
  return {
    nome: texto(input.nome, 'nome', 200) ?? keywords[0].slice(0, 200),
    keywords,
    lang,
    depth: inteiro(input.depth, 'profundidade', 1, 10, 1),
    email: input.email === true,
    max_minutos: inteiro(input.max_minutos, 'tempo máximo', 3, 120, 10),
  }
}

export function createStore(file) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  data.buscas ??= []
  // grava num temporário e renomeia, para um crash no meio não corromper o arquivo
  const salvar = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(data))
    renameSync(`${file}.tmp`, file)
  }
  const agora = () => new Date().toISOString()
  const achar = (id) => {
    const b = data.buscas.find((x) => x.id === id)
    if (!b) throw new NotFoundError('busca não encontrada')
    return b
  }
  // a listagem não leva os leads de cada busca, que podem ser milhares
  const resumo = ({ leads, enviados_ids, ...b }) => b

  return {
    createBusca(busca, scraperJobId) {
      const ts = agora()
      const b = { id: randomUUID(), ...busca, scraper_job_id: scraperJobId, status: 'pendente', encontrados: 0, ignorados: 0, enviados: null, erro: null, leads: [], created_at: ts, updated_at: ts }
      data.buscas.push(b)
      salvar()
      return resumo(b)
    },

    updateBusca(id, { status, encontrados, ignorados, erro, leads }) {
      const b = achar(id)
      Object.assign(b, Object.fromEntries(Object.entries({ status, encontrados, ignorados, erro, leads }).filter(([, v]) => v !== undefined)), { updated_at: agora() })
      salvar()
      return resumo(b)
    },

    // chamado pela tela depois de mandar ao CRM as empresas escolhidas: marca quais foram e soma quantas entraram de fato
    marcarEnviados(id, input) {
      objeto(input)
      const b = achar(id)
      if (b.status !== 'importado') throw new ValidationError('a busca ainda não terminou')
      const ids = input.place_ids
      if (!Array.isArray(ids) || !ids.length || ids.length > b.leads.length) throw new ValidationError('informe as empresas mandadas')
      const daBusca = new Set(b.leads.map((l) => l.place_id))
      if (!ids.every((p) => typeof p === 'string' && daBusca.has(p))) throw new ValidationError('empresa não é desta busca')
      const novos = inteiro(input.novos, 'novos', 0, ids.length, 0)
      b.enviados_ids = [...new Set([...(b.enviados_ids ?? []), ...ids])]
      b.enviados = (b.enviados ?? 0) + novos
      b.updated_at = agora()
      salvar()
      return resumo(b)
    },

    leadsDaBusca(id) {
      const b = achar(id)
      const enviados = new Set(b.enviados_ids ?? [])
      return b.leads.map((l) => ({ ...l, enviado: enviados.has(l.place_id) }))
    },

    listBuscas({ page, limit } = {}) {
      const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
      const todas = [...data.buscas].sort((a, b) => b.created_at.localeCompare(a.created_at))
      const paginas = Math.max(1, Math.ceil(todas.length / lim))
      const pagina = Math.min(Math.max(Number.parseInt(page, 10) || 1, 1), paginas)
      return { itens: todas.slice((pagina - 1) * lim, pagina * lim).map(resumo), total: todas.length, pagina, paginas }
    },

    buscasAtivas() {
      return data.buscas.filter((b) => b.status === 'pendente' || b.status === 'executando')
    },
  }
}
