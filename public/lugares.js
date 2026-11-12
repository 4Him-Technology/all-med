// Mapa das empresas do Google Maps guardadas no CRM online: filtros, contagens e área do mapa, sem DOM
// (testado em test/lugares.test.js)
import { norm } from './campos.js'

const alfabetica = new Intl.Collator('pt-BR')
const numero = (n) => n.toLocaleString('pt-BR')
const nota = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// as listas são trocadas por inteiro a cada mudança, nunca alteradas no lugar
export const FILTRO_VAZIO = Object.freeze({ q: '', segmentos: Object.freeze([]), locais: Object.freeze([]), categorias: Object.freeze([]), notaMin: 0, comSite: false, comCelular: false, semKanban: false })

// O Google não informa o tipo do telefone: celular é o número de 9 dígitos começando em 9 (com DDD); fixo, o de 8 começando em 2 a 5
const digitos = (tel) =>
  String(tel ?? '')
    .replace(/\D/g, '')
    .replace(/^55(?=\d{10,11}$)/, '')

export function tipoTelefone(tel) {
  const d = digitos(tel)
  return /^\d{2}9\d{8}$/.test(d) ? 'celular' : /^\d{2}[2-5]\d{7}$/.test(d) ? 'fixo' : 'outro'
}

export const linkWhatsApp = (tel) => (tipoTelefone(tel) === 'celular' ? `https://wa.me/55${digitos(tel)}` : null)

// Uma empresa por place_id: a mesma pode ter vindo da pesquisa em dois segmentos ou em dois locais
export function juntarLugares(linhas) {
  const porId = new Map()
  for (const { segmento, local_busca, servico, ...r } of linhas) {
    let l = porId.get(r.place_id)
    if (!l) {
      l = {
        ...r,
        avaliacao: r.avaliacao == null ? null : Number(r.avaliacao),
        enviado: false,
        segmentos: [],
        locais: [],
        servicos: [],
        celular: tipoTelefone(r.telefone) === 'celular',
        busca: norm(`${r.nome} ${r.categoria ?? ''} ${r.endereco ?? ''}`),
      }
      porId.set(r.place_id, l)
    }
    l.enviado ||= Boolean(r.enviado)
    for (const [lista, v] of [[l.segmentos, segmento], [l.locais, local_busca], [l.servicos, servico]]) if (v && !lista.includes(v)) lista.push(v)
  }
  for (const l of porId.values()) for (const lista of [l.segmentos, l.locais, l.servicos]) lista.sort(alfabetica.compare)
  return [...porId.values()]
}

// exceto: nome do filtro a ignorar (serve para contar as opções daquele filtro)
export function filtrarLugares(lugares, f, exceto) {
  const palavras = norm(f.q).split(/\s+/).filter(Boolean)
  const algum = (campo, valores) => exceto === campo || !f[campo].length || valores.some((v) => f[campo].includes(v))
  return lugares.filter(
    (l) =>
      algum('segmentos', l.segmentos) &&
      algum('locais', l.locais) &&
      algum('categorias', [l.categoria]) &&
      (l.avaliacao ?? 0) >= f.notaMin &&
      (!f.comSite || Boolean(l.site)) &&
      (!f.comCelular || l.celular) &&
      (!f.semKanban || !l.enviado) &&
      palavras.every((p) => l.busca.includes(p)),
  )
}

// Quantas empresas cada opção de segmento, local e categoria traria, com os outros filtros como estão
export function facetas(lugares, f) {
  const contar = (campo, valores) => {
    const m = new Map()
    for (const l of filtrarLugares(lugares, f, campo)) for (const v of valores(l)) m.set(v, (m.get(v) ?? 0) + 1)
    return m
  }
  return {
    segmentos: contar('segmentos', (l) => l.segmentos),
    locais: contar('locais', (l) => l.locais),
    categorias: contar('categorias', (l) => (l.categoria ? [l.categoria] : [])),
  }
}

// empresa sem localização não tem como estar fora da área: fica sempre na lista
export const naArea = (lugares, a) =>
  lugares.filter((l) => l.latitude == null || l.longitude == null || (l.latitude >= a.sul && l.latitude <= a.norte && l.longitude >= a.oeste && l.longitude <= a.leste))

export function ordenarLugares(lugares, ordem) {
  const porNome = (a, b) => alfabetica.compare(a.nome, b.nome)
  return [...lugares].sort(ordem === 'nota' ? (a, b) => (b.avaliacao ?? 0) - (a.avaliacao ?? 0) || porNome(a, b) : porNome)
}

// "Lapa, São Paulo - SP" é o bairro Lapa da cidade São Paulo; "Osasco - SP" é a cidade toda
function partes(local) {
  const [, bairro, cidade] = local.match(/^(?:(.+), )?(.+?)(?: - [A-Z]{2})?$/)
  return { bairro, cidade }
}

export const rotuloLocal = (local) => partes(local).bairro ?? partes(local).cidade

// Locais da busca agrupados por cidade, para a lista de regiões do filtro
export function regioes(locais) {
  const grupos = new Map()
  for (const valor of locais) {
    const { bairro, cidade } = partes(valor)
    if (!grupos.has(cidade)) grupos.set(cidade, [])
    grupos.get(cidade).push({ valor, bairro })
  }
  return [...grupos]
    .sort(([a], [b]) => alfabetica.compare(a, b))
    .map(([cidade, itens]) => ({
      cidade,
      // a cidade toda vem primeiro; sozinha no grupo, leva só o nome dela
      itens: itens
        .sort((a, b) => ((a.bairro == null) !== (b.bairro == null) ? (a.bairro == null ? -1 : 1) : alfabetica.compare(a.bairro ?? '', b.bairro ?? '')))
        .map(({ valor, bairro }) => ({ valor, rotulo: bairro ?? (itens.length > 1 ? `${cidade} (cidade)` : cidade) })),
    }))
}

// Uma etiqueta por filtro ligado; o segmento fica de fora porque o botão dele já mostra que está ligado
export function etiquetasDoMapa(f) {
  return [
    ...f.locais.map((valor) => ({ campo: 'locais', valor, rotulo: rotuloLocal(valor) })),
    ...f.categorias.map((valor) => ({ campo: 'categorias', valor, rotulo: valor })),
    f.notaMin > 0 && { campo: 'notaMin', valor: f.notaMin, rotulo: `Nota ${nota(f.notaMin)} ou mais` },
    f.comSite && { campo: 'comSite', valor: true, rotulo: 'Com site' },
    f.comCelular && { campo: 'comCelular', valor: true, rotulo: 'Com celular' },
    f.semKanban && { campo: 'semKanban', valor: true, rotulo: 'Fora do kanban' },
  ].filter(Boolean)
}

export const semEtiqueta = (f, { campo, valor }) => ({ ...f, [campo]: Array.isArray(f[campo]) ? f[campo].filter((v) => v !== valor) : campo === 'notaMin' ? 0 : false })

// Opções de um filtro com muitas opções (categoria do Google): marcadas primeiro, depois as mais comuns
export function listarOpcoes(contagem, marcadas, termo = '', limite = 12) {
  const t = norm(termo).trim()
  const todas = [...new Set([...marcadas, ...contagem.keys()])]
    .filter((v) => norm(v).includes(t))
    .map((valor) => ({ valor, n: contagem.get(valor) ?? 0, marcada: marcadas.includes(valor) }))
    .sort((a, b) => b.marcada - a.marcada || b.n - a.n || alfabetica.compare(a.valor, b.valor))
  return { opcoes: todas.slice(0, limite), resto: Math.max(0, todas.length - limite) }
}

export function resumoDaArea(naTela, noFiltro) {
  const empresas = `${numero(noFiltro)} ${noFiltro === 1 ? 'empresa' : 'empresas'}`
  return naTela === noFiltro ? empresas : `${numero(naTela)} de ${empresas} nesta área do mapa`
}

// Empresa no formato do lead do CRM: só as colunas que o banco aceita, e de qual pesquisa ela veio nas observações
export const leadDoLugar = (l) => ({
  place_id: l.place_id,
  nome: l.nome,
  categoria: l.categoria,
  endereco: l.endereco,
  telefone: l.telefone,
  site: l.site,
  avaliacao: l.avaliacao,
  latitude: l.latitude,
  longitude: l.longitude,
  link_maps: l.link_maps,
  origem: 'maps',
  observacoes: [`Pesquisa no Google Maps: ${l.segmentos.join(', ')} em ${l.locais.map(rotuloLocal).join(', ')}`, l.servicos.length > 0 && `Serviço: ${l.servicos.join(', ')}`].filter(Boolean).join('\n'),
})

// ---------- busca nova pelo PC entrando no mapa do CRM online ----------
const inicial = (t) => t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1)

// O termo da busca é "<ramo> em <bairro>, <cidade>" (buscaMaps, em campos.js): o ramo vira o segmento e o resto, o local.
// O local é o que vem depois do último " em ", porque o ramo pode ter "em" no meio. Sem local, null.
export function origemDaBusca(busca) {
  const partes = (busca.keywords ?? []).map((k) => String(k).match(/^(.+) em (.+)$/)).filter(Boolean)
  if (!partes.length) return null
  const segmento = [...new Set(partes.map((m) => inicial(m[1].trim())))].join(', ').slice(0, 100)
  const local_busca = partes[0][2]
    .split(',')
    .map((p) => inicial(p.trim()))
    .filter(Boolean)
    .join(', ')
    .slice(0, 200)
  return segmento && local_busca ? { segmento, local_busca } : null
}

const corte = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const link = (v, max) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) && v.trim().length <= max ? v.trim() : null)

// Empresas que a busca do PC achou, no formato da tabela maps_lugares. Entra só quem tem endereço, telefone e nota,
// como na carga das planilhas (o banco recusa o resto); fora conta as que ficaram de fora. Uma linha por lugar,
// porque o upsert falha com a mesma chave duas vezes; deleted_at null traz de volta a empresa de uma busca excluída.
export function lugaresDaBusca(busca, leads) {
  const origem = origemDaBusca(busca)
  const porId = new Map()
  let fora = 0
  for (const l of leads) {
    const [place_id, nome, endereco, telefone] = [corte(l.place_id, 300), corte(l.nome, 200), corte(l.endereco, 500), corte(l.telefone, 50)]
    const avaliacao = l.avaliacao == null ? Number.NaN : Number(l.avaliacao)
    if (!origem || !place_id || !nome || !endereco || !telefone || !(avaliacao >= 0 && avaliacao <= 5)) {
      fora++
      continue
    }
    if (porId.has(place_id)) continue
    const [lat, lng, total] = [Number(l.latitude), Number(l.longitude), Number(l.total_avaliacoes)]
    const noMapa = l.latitude != null && l.longitude != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    porId.set(place_id, {
      place_id,
      ...origem,
      nome,
      categoria: corte(l.categoria, 200),
      endereco,
      telefone,
      site: link(l.site, 500),
      avaliacao: Math.round(avaliacao * 10) / 10,
      total_avaliacoes: l.total_avaliacoes != null && Number.isInteger(total) && total >= 0 ? total : null,
      latitude: noMapa ? lat : null,
      longitude: noMapa ? lng : null,
      link_maps: link(l.link_maps, 1000),
      deleted_at: null,
    })
  }
  return { linhas: [...porId.values()], fora }
}

// Lê todas as páginas de uma consulta: a API devolve um teto de linhas por vez (1000 no padrão do CRM online)
// pagina(de, ate) devolve { data, count }
export async function lerTudo(pagina, tamanho = 1000) {
  const primeira = await pagina(0, tamanho - 1)
  // o passo é o que o servidor devolveu de fato, que pode ser menos do que o pedido
  const passo = primeira.data.length
  const total = primeira.count ?? passo
  if (!passo || passo >= total) return primeira.data
  const resto = await Promise.all(Array.from({ length: Math.ceil(total / passo) - 1 }, (_, i) => pagina((i + 1) * passo, (i + 2) * passo - 1)))
  return [primeira, ...resto].flatMap((p) => p.data)
}
