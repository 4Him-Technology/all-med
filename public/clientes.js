// Reconhece pelo nome a empresa que já é cliente ativo, para ela não voltar à prospecção (testado em test/clientes.test.js).
// A lista de clientes traz a razão social (com Ltda, S.A., CNPJ e a unidade depois do traço); o Google mostra o nome fantasia.
// shortcut: só o nome é comparado, porque a lista não tem CNPJ, telefone nem endereço; com o CNPJ dos clientes, a Prospecção compararia por ele
import { norm } from './campos.js'

// palavras que não dizem quem é a empresa
const LIGACAO = new Set('de da do das dos e a o em para the ltda limitada me epp eireli sa s cia matriz filial cnpj'.split(' '))
// palavras de ramo: sozinhas, ou só elas em comum, não identificam ninguém
const RAMO = new Set(
  (
    'industria industrial comercio comercial servico servicos engenharia construtora construcao construccion transportes transporte ' +
    'logistica alimentos brasil gestao consultoria consultores saude ocupacional medicina seguranca sistemas solucoes tecnologia ' +
    'participacoes empreendimento empreendimentos incorporadora equipamentos montagens montagem manutencao armazens armazenagem gerais ' +
    'locacao sao paulo ambiental social grupo companhia nacional assessoria empresarial embalagens plasticos metais metalurgica instalacoes ' +
    'viacao padaria panificadora confeitaria restaurante loja distribuidora representacoes associados cooperativa instituto fundacao ' +
    'centro clinica laboratorio supermercado supermercados mercado atacado varejo rodoviario rodoviarios encomendas cargas express expresso'
  ).split(' '),
)
const CNPJ = /\d{2}\.?\d{3}\.?\d{3}\s*\/\s*\d{4}\s*-?\s*\d{2}/g

const palavras = (s) =>
  norm(String(s ?? '').replace(CNPJ, ' '))
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !LIGACAO.has(p))
const proprias = (ps) => ps.filter((p) => !RAMO.has(p) && !/^\d+$/.test(p)).length
// o que vem antes do primeiro traço ou parêntese: o resto da razão social costuma ser unidade, CNPJ ou descrição
const principal = (nome) => palavras(String(nome ?? '').split(/\s\p{Pd}\s|\(/u)[0])

// prepara a lista uma vez; cliente sem nenhuma palavra que conte (só "Ltda", por exemplo) fica de fora
export const prepararClientes = (clientes) =>
  clientes
    .map((cliente) => {
      const c = principal(cliente.nome)
      return { cliente, c, proprias: proprias(c) }
    })
    .filter((p) => p.c.length > 0)

// devolve o cliente cujo nome bate com o da empresa, ou null
export function clienteDe(nome, preparados) {
  const l = palavras(nome)
  if (!l.length) return null
  const tem = new Set(l)
  const lProprias = proprias(l)
  for (const { cliente, c, proprias: cProprias } of preparados) {
    const clienteNaEmpresa = c.every((p) => tem.has(p))
    const empresaNoCliente = l.every((p) => c.includes(p))
    // as mesmas palavras, em qualquer ordem
    if (clienteNaEmpresa && empresaNoCliente) return cliente
    // a empresa tem o nome do cliente inteiro; cliente de uma palavra só vale quando ela abre o nome da empresa
    if (clienteNaEmpresa && cProprias > 0 && (c.length > 1 || (c[0].length >= 4 && l[0] === c[0]))) return cliente
    // o cliente tem o nome da empresa inteiro: com duas palavras próprias, ou uma só que abre o nome do cliente
    if (empresaNoCliente && (lProprias >= 2 || (l.length === 1 && lProprias === 1 && l[0].length >= 4 && l[0] === c[0]))) return cliente
  }
  return null
}
