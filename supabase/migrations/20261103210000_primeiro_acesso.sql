-- Primeiro acesso: o admin cadastra só nome, e-mail e papel; a pessoa digita o e-mail na tela de login e cria a
-- própria senha, uma vez só (pedido do Filipe em 03/11/2026, ciente de que quem souber o e-mail de alguém ainda
-- pendente pode criar a senha antes dele). Quem faz isso é a função "usuarios"; o app só lê a coluna.
--
-- Rollback: alter table public.membros drop column ativado_em;

alter table public.membros add column ativado_em timestamptz;

-- quem já tinha conta entrava com senha: o primeiro acesso já está feito
update public.membros set ativado_em = created_at;

-- a lista de usuários mostra quem ainda está aguardando o primeiro acesso
grant select (ativado_em) on public.membros to authenticated;
