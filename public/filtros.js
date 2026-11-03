// Filtros da prospecção sem DOM: rótulos e as etiquetas do que está ligado (testado em test/filtros.test.js)

// listas de pares para manter a ordem na tela (objeto com chave numérica sempre sai em ordem crescente)
export const ORDEM_SITUACOES = [['2', 'Ativa'], ['3', 'Suspensa'], ['4', 'Inapta'], ['8', 'Baixada'], ['1', 'Nula']]
export const ORDEM_PORTES = [['1', 'Microempresa'], ['3', 'Pequeno porte'], ['5', 'Demais'], ['0', 'Não informado']]
export const SITUACOES = Object.fromEntries(ORDEM_SITUACOES)
export const PORTES = Object.fromEntries(ORDEM_PORTES)
export const FAIXAS = { 2: '13 a 20', 3: '21 a 30', 4: '31 a 40', 5: '41 a 50', 6: '51 a 60', 7: '61 a 70', 8: '71 a 80', 9: 'Mais de 80' }
export const CONTATO = {
  com_telefone: 'Somente com telefone',
  com_celular: 'Somente com celular',
  com_email: 'Somente com e-mail',
  ocultar_email_contabilidade: 'Ocultar e-mail de contabilidade',
  com_socio_fundador: 'Somente com sócio fundador',
}
const ESCOLHAS = {
  simples: { sim: 'Optante do Simples', nao: 'Fora do Simples' },
  mei: { sim: 'Somente MEI', nao: 'Sem MEI' },
  matriz: { matriz: 'Somente matriz', filial: 'Somente filial' },
}

export const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
export const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '')

// Uma etiqueta por filtro ligado, na ordem dos grupos da barra. campo e valor dizem o que o x desliga.
// nomes: Map de código para nome das cidades, CNAEs e naturezas escolhidas (o filtro só guarda o código)
export function etiquetasDosFiltros(f, nomes = {}) {
  const out = []
  const add = (campo, valor, rotulo) => out.push({ rotulo, campo, valor: String(valor) })
  const lista = (campo, rotulo) => {
    for (const v of f[campo] ?? []) add(campo, v, rotulo(v))
  }
  lista('ufs', (v) => v)
  lista('municipios', (v) => nomes.municipios?.get(v) ?? v)
  lista('bairros', (v) => `Bairro ${v}`)
  lista('cnaes', (v) => nomes.cnaes?.get(v) ?? v)
  if (f.incluir_secundarios) add('incluir_secundarios', true, 'Inclui atividade secundária')
  lista('situacoes', (v) => SITUACOES[v] ?? v)
  lista('portes', (v) => PORTES[v] ?? v)
  lista('naturezas', (v) => nomes.naturezas?.get(v) ?? v)
  for (const [campo, rotulos] of Object.entries(ESCOLHAS)) if (f[campo]) add(campo, f[campo], rotulos[f[campo]] ?? f[campo])
  if (f.abertura_de) add('abertura_de', f.abertura_de, `Aberta desde ${dataBr(f.abertura_de)}`)
  if (f.abertura_ate) add('abertura_ate', f.abertura_ate, `Aberta até ${dataBr(f.abertura_ate)}`)
  if (f.capital_min != null) add('capital_min', f.capital_min, `Capital a partir de ${moeda.format(f.capital_min)}`)
  if (f.capital_max != null) add('capital_max', f.capital_max, `Capital até ${moeda.format(f.capital_max)}`)
  for (const [k, rotulo] of Object.entries(CONTATO)) if (f[k]) add('contato', k, rotulo)
  lista('faixas_socio', (v) => `Sócio de ${FAIXAS[v] ?? v}`)
  return out
}
