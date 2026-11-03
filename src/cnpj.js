// Ponte local para as funções SQL da base de CNPJ (as mesmas que o front chama via supabase.rpc em produção)
import { NotFoundError, ValidationError } from './store.js'

const CHAMADAS = {
  // filtros entram como texto: num parâmetro jsonb o postgres.js aplica JSON.stringify de novo e o banco receberia uma string JSON
  buscar_empresas: (a) => ['select public.buscar_empresas($1::text::jsonb, $2, $3) as r', [JSON.stringify(a.filtros ?? {}), a.pagina ?? 1, a.por_pagina ?? 50]],
  cnpj_detalhe: (a) => ['select public.cnpj_detalhe($1) as r', [String(a.p_cnpj ?? '')]],
  cnpj_referencias: () => ['select public.cnpj_referencias() as r', []],
  cnpj_municipios: (a) => ['select public.cnpj_municipios($1) as r', [a.p_uf == null ? null : String(a.p_uf)]],
}

export const consultaPglite = (db) => async (sql, params) => (await db.query(sql, params)).rows
export const consultaPostgres = (sql) => (query, params) => sql.unsafe(query, params)

export function criarCnpj(consulta) {
  return {
    async rpc(nome, args) {
      const chamada = Object.hasOwn(CHAMADAS, nome) && CHAMADAS[nome]
      if (!chamada) throw new NotFoundError('função não encontrada')
      try {
        const [rows] = await consulta(...chamada(args ?? {}))
        return rows.r
      } catch (err) {
        // classe 22 do Postgres = dado de entrada inválido (filtro mal formado, data ou número errado)
        if (String(err.code ?? '').startsWith('22')) throw new ValidationError(err.message)
        throw err
      }
    },
  }
}
