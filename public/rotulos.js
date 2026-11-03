// mesmos valores dos enums da migration do Supabase (supabase/migrations)
export const ROTULOS = {
  status: { novo: 'Novo', contato: 'Em contato', qualificado: 'Qualificado', proposta: 'Proposta', negociacao: 'Negociação', ganho: 'Ganho', perdido: 'Perdido' },
  temperatura: { quente: 'Quente', morno: 'Morno', frio: 'Frio' },
  tipo: { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', reuniao: 'Reunião', visita: 'Visita', outro: 'Outro', status: 'Mudança de status' },
  status_busca: { pendente: 'Na fila', executando: 'Executando', importado: 'Pronta', falhou: 'Falhou' },
}
export const STATUS = Object.keys(ROTULOS.status)
