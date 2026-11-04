# Leads Maps CRM

Gerenciador de leads com kanban de acompanhamento e histórico de atendimentos. Os leads chegam pela prospecção na base de CNPJ da Receita Federal e por buscas no Google Maps feitas pelo [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper). Não usa IA em nenhuma etapa. Projeto pessoal.

## Como está dividido

| Parte | Onde roda | O que tem | Custo |
|---|---|---|---|
| CRM online | Supabase pessoal (plano Free) + site estático (Netlify ou Cloudflare Pages) | Login, leads, kanban, histórico de atendimentos | 0 |
| Prospecção | PC com Docker | Base de CNPJ da Receita (Postgres), importador mensal, scraper do Google Maps | Só o disco do PC |

A mesma pasta `public/` serve as duas partes. No PC, o servidor local entrega a tela com as abas Prospecção e Google Maps, e o envio de empresas grava direto no Supabase, logado com o seu usuário. Na web, o site mostra só Kanban e Leads. O Supabase nunca vê a base de CNPJ, só as empresas que você escolhe.

## 1. Configurar o Supabase (uma vez)

1. Crie um projeto na sua conta pessoal do Supabase.
2. Aplique a migration do CRM: cole [supabase/migrations/20261027150000_crm.sql](supabase/migrations/20261027150000_crm.sql) no SQL Editor do painel e rode (ou `supabase db push` com a CLI ligada ao projeto).
3. Em Authentication > Users, crie o seu usuário com e-mail e senha. Depois, em Authentication > Sign In / Providers, desligue o cadastro aberto ("Allow new users to sign up").
4. Copie a URL do projeto e a chave pública (Project Settings > API) para o `.env` (veja o `.env.example`). Nunca use a chave secreta: ela vai para o navegador e passa por cima da RLS. O código recusa a chave secreta se ela for colocada no lugar errado.

Depois, as migrations seguintes da mesma pasta, em ordem, e a função de cadastro de usuários ([INSTALAR.md](INSTALAR.md), "Usuários da equipe").

O que as migrations garantem no banco, testado em [test/crm-sql.test.js](test/crm-sql.test.js):

- a equipe (membros ativos) vê e trabalha os mesmos leads e atendimentos (RLS); conta fora da equipe, membro desativado e visitante sem login não leem nada;
- só a função `usuarios`, com a chave secreta, cadastra e desativa membros, e só a pedido de um admin; o primeiro acesso (a pessoa cadastrada cria a própria senha digitando o e-mail) vale uma vez só, com tentativas limitadas ([test/usuarios.test.js](test/usuarios.test.js));
- quem criou, origem, CNPJ e datas não podem ser alterados depois de criados (permissão por coluna);
- nada é apagado de verdade: arquivar preenche `deleted_at`, e o histórico de atendimentos é imutável;
- mudança de coluna no kanban grava sozinha no histórico, e o usuário não consegue forjar esse registro;
- a mesma empresa (CNPJ ou lugar do Maps) não entra duas vezes na equipe, nem depois de arquivada;
- a conta de quem criou um lead não pode ser apagada (o trabalho é da equipe); para tirar alguém, desativa-se;
- site, e-mails, CNPJ, avaliação e tamanhos de texto são validados por CHECK.

## 2. Rodar a parte do PC (Docker)

Passo a passo completo no Windows, do zero: [INSTALAR.md](INSTALAR.md). Resumo:

1. Instale o Docker (Docker Desktop no Windows ou Mac, Docker Engine no Linux).
2. Clone o repositório (`git clone https://github.com/4Him-Technology/all-med.git`), crie o `.env` a partir do `.env.example`, troque `POSTGRES_PASSWORD` e preencha as variáveis do Supabase.
3. Suba e abra `http://localhost:3000`:

```bash
docker compose up -d --build
```

4. Carregue a base da Receita. Comece por um estado para medir o tempo; sem `--ufs` vai o Brasil inteiro, que pede uns 100 GB livres:

```bash
docker compose run --rm app node importador/importar.js --ufs SP
```

5. Para usar também a aba Google Maps:

```bash
docker compose --profile maps up -d
```

Detalhes:

- A migration da base de CNPJ ([db-local/migrations/](db-local/migrations/)) roda sozinha na primeira subida, com o volume do banco vazio. Uma migration nova depois disso: `docker compose cp db-local/migrations/<arquivo>.sql db:/tmp/m.sql` e `docker compose exec db psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/m.sql` (o `<` do bash não funciona no PowerShell).
- Backup: o que importa está no Supabase (faça o backup por lá). No PC ficam só a base de CNPJ, que dá para recarregar da Receita, e as buscas do Maps ainda não enviadas, no volume `crmdata`.
- Para voltar a base de CNPJ ao mês anterior: `docker compose exec db psql -U postgres -c "select cnpj_carga.reverter()"`.
- As portas ficam presas em `127.0.0.1`: a tela local não tem login próprio e não deve ser aberta na rede.

## 3. Publicar o site (Kanban e Leads na web)

No Netlify ou no Cloudflare Pages, ligue o repositório e configure:

- comando de build: `node scripts/gerar-config.js`
- pasta publicada: `public`
- variáveis: `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`; no Cloudflare, também `NODE_VERSION=24.19.0` e `SKIP_DEPENDENCY_INSTALL=1`
- opcional: `PC_URL` com o endereço do túnel até o PC ([INSTALAR.md](INSTALAR.md), passo 8), que faz Prospecção e Google Maps aparecerem no site enquanto o PC estiver ligado

O build gera `public/config.js` (com `local: false`, que esconde as abas do PC) e `public/_headers` com CSP, HSTS e os demais cabeçalhos de segurança. Depois coloque o endereço do site em `WEB_URL` no `.env` do PC para ter o atalho "CRM online".

Rollback do site: os dois hosts guardam os deploys anteriores e voltam com um clique. Rollback do banco: o script de desfazer está no topo da migration.

## Prospecção por CNPJ

Usa os [dados abertos do CNPJ](https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj) que a Receita publica todo mês (cerca de 8 GB compactados, uns 70 milhões de estabelecimentos).

| Grupo | Filtros | Como sai da base da Receita |
|---|---|---|
| Localização | vários estados, várias cidades, bairros | `uf`, `municipio` e `bairro`. Bairro compara sem acento e sem caixa, mas o nome precisa bater ("JD" e "JARDIM" contam como nomes diferentes) |
| Ramo | CNAE, com opção de incluir atividade secundária | `cnae_fiscal_principal` e `cnae_fiscal_secundaria` |
| Situação | ativa, suspensa, inapta, baixada, nula | `situacao_cadastral` |
| Perfil | porte (micro, pequeno porte, demais, não informado), Simples, MEI, matriz/filial, natureza jurídica | arquivos Empresas e Simples |
| Abertura e capital | intervalo de datas, capital mínimo e máximo | `data_inicio_atividade`, `capital_social` |
| Contato e sócios | só com telefone, só com celular, só com e-mail, ocultar e-mail de contabilidade, só com sócio fundador, faixa etária do sócio principal | ver limitações abaixo |

Limitações que vêm da própria base:

- **Celular**: a Receita não marca o tipo. É celular o número de 9 dígitos começando em 9, ou de 8 dígitos começando em 6 a 9 (cadastro antigo); fixo começa em 2 a 5.
- **E-mail de contabilidade**: é marcado assim o e-mail que aparece em 5 ou mais empresas diferentes, ou que tem "contab", "contador", "escritorio" ou "assessoria" no endereço.
- **Idade do sócio**: a Receita só informa a faixa etária, nunca a idade exata, e o CPF vem mascarado. O sócio principal é a pessoa física com cargo de gestão que entrou primeiro.
- **Sócio fundador**: sócio cuja data de entrada é igual ou anterior à data de abertura da matriz.
- **MEI e empresário individual** não têm quadro de sócios, então os filtros de sócio não os alcançam.
- Telefone e e-mail são os declarados à Receita e podem estar desatualizados.

A carga mensal ([importador/importar.js](importador/importar.js)) baixa e descompacta em streaming, faz COPY direto no Postgres, monta tudo num esquema separado e só troca no fim. Se algo falhar no meio, a base publicada continua a anterior.

Sem Docker, dá para testar a tela com `CNPJ_DEMO=1` no `.env` e `npm start`: o servidor sobe um Postgres em memória (PGlite) com cinco empresas fictícias.

## Google Maps

Na aba Google Maps você cadastra uma busca ("dentistas em Campinas"). O servidor local manda para o scraper, acompanha o job e guarda o resultado no PC. Quando a busca fica pronta, o botão "Enviar ao kanban" manda os leads para o Supabase; os que já estão lá (mesmo lugar do Maps) o banco ignora.

O scraper só roda em Docker. O `.exe` de Windows v1.18.1 falha em toda busca (issue [gosom/google-maps-scraper#322](https://github.com/gosom/google-maps-scraper/issues/322)). `npm run scraper:fake` sobe um servidor que imita a API do gosom com empresas fictícias, para mexer na tela sem raspar o Google.

## Segurança

- Tela local: presa em `127.0.0.1`, checagem do cabeçalho Host (contra DNS rebinding), POST só com `application/json`, CSP restrita, DOM montado sem `innerHTML`, sem stack trace nas respostas.
- CRM online: autorização toda no banco (RLS e permissão por coluna); o navegador só tem a chave pública.
- **Sessão de login**: fica no `sessionStorage` (some ao fechar a aba), não em cookie HttpOnly. Num site estático o cookie HttpOnly exige uma função no servidor intermediando o login. O risco que sobra é XSS, contido pela CSP (só o próprio site e o supabase-js em versão fixa no jsDelivr). Se quiser o cookie HttpOnly, dá para colocar essa função no Netlify ou no Cloudflare Pages.
- Tentativas de login: o Supabase Auth já limita por IP. Dá para ligar CAPTCHA no painel se o site ficar público.

## Uso responsável

Os termos do Google Maps proíbem raspagem automatizada; o risco prático é bloqueio de IP, e o jurídico é seu. Na base da Receita, nome de sócio, telefone e e-mail de empresário individual são dado pessoal pela LGPD: para prospecção a base legal costuma ser o legítimo interesse, o que exige oferecer descadastro e não usar a lista para outra finalidade. A função de detalhe não devolve o CPF, mesmo mascarado.

## Estrutura

| Caminho | Papel |
|---|---|
| `supabase/migrations/` | CRM online: tabelas, RLS, permissões, histórico automático |
| `db-local/migrations/` | Base de CNPJ no PC: esquema, montagem mensal, funções de busca |
| `importador/` | Download, descompactação e carga mensal dos arquivos da Receita |
| `src/` | Servidor local: tela, ponte para a base de CNPJ (`/api/rpc/<função>`), buscas do Maps, `config.js` |
| `public/` | Front em JS puro, usado no PC e na web (`crm.js` fala com o Supabase, `prospeccao.js` com a base local) |
| `scripts/gerar-config.js` | Build do site: `config.js` e `_headers` |
| `test/` | Testes (`node:test`; PGlite roda as duas migrations de verdade), scraper falso e dados fictícios |

```bash
npm test
```
