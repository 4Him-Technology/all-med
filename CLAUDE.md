# Instruções para agentes

Projeto pessoal do Filipe (não é da APSIS): nunca usar contas, bancos ou nuvem da APSIS. Leia o README, o PRODUCT.md e o DESIGN.md antes de mexer.

## Fluxo de trabalho

- Toda tarefa (correção, melhoria ou função nova) tem uma issue no GitHub.
- Nada vai direto para a `main`: branch, PR mencionando a issue (`Closes #N`) e merge depois da revisão.
- Commits no padrão Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`...).
- Testes antes da implementação (`npm test`, `node:test`).
- Toda mudança que vai para o PC ou para o site diz como voltar atrás (ver "Voltar atrás" no INSTALAR.md).

## Regras do produto

- A palavra "Supabase" não aparece em nenhum texto da interface; use "CRM online".
- O kanban fica como está; telas novas não mexem nele.
- Textos da interface e da documentação em português, sem travessão (use hífen).
- Chave secreta do Supabase nunca no código nem no front; só a publishable, e a autorização fica na RLS.
- Mudança de banco só por migration nova (`supabase/migrations/` para o CRM, `db-local/migrations/` para a base de CNPJ).
