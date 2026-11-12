# Instalar no PC (Windows)

Passo a passo para deixar o PC que usa o sistema com a prospecção por CNPJ e o Google Maps rodando no Docker. O CRM (login, leads, kanban) continua online e não precisa de nada aqui além da URL e da chave pública.

Os comandos são para o PowerShell. Abra pelo menu Iniciar ("PowerShell"), sem precisar ser administrador, a não ser onde estiver dito.

## O que o PC precisa

- Windows 10 ou 11 de 64 bits, com virtualização ligada na BIOS (Intel VT-x ou AMD SVM; quase todo PC recente já vem ligado).
- 8 GB de RAM ou mais. O banco está ajustado para carga pesada; com menos memória, veja "Problemas comuns".
- Espaço em disco: o Docker e as imagens ocupam alguns GB. O espaço da base depende de quantos estados você carregar (o Brasil inteiro passa de 100 GB).
- Internet para baixar a base da Receita: cada carga baixa uns 8 GB, mesmo carregando um estado só.

## 1. Instalar o Git

Baixe e instale o Git for Windows em https://git-scm.com/download/win, com as opções padrão. Ele traz o login do GitHub pelo navegador, que vai ser usado no passo 3.

## 2. Instalar o Docker Desktop

1. Baixe em https://www.docker.com/products/docker-desktop/ (Download for Windows, AMD64 na maioria dos PCs).
2. Instale deixando marcado "Use WSL 2 instead of Hyper-V". Reinicie o PC se ele pedir.
3. Abra o Docker Desktop e espere aparecer "Engine running" no canto inferior esquerdo. Para uso pessoal ele é gratuito.
4. Em Settings > General, deixe marcado "Start Docker Desktop when you sign in". Assim o sistema volta sozinho quando o PC liga.
5. Opcional: se o disco C: for pequeno, mude o local dos dados em Settings > Resources > Advanced > Disk image location, antes de carregar a base.

Confira no PowerShell:

```powershell
docker version
docker compose version
```

Se aparecer erro de WSL, rode `wsl --update` num PowerShell aberto como administrador e abra o Docker Desktop de novo.

## 3. Baixar o sistema

```powershell
cd $HOME
git clone https://github.com/4Him-Technology/all-med.git
cd all-med
```

Se o repositório for privado, o Git abre o navegador para você entrar no GitHub. Os próximos comandos são todos rodados dentro da pasta `all-med`.

## 4. Criar o .env

```powershell
Copy-Item .env.example .env
notepad .env
```

No Docker só três linhas importam (as outras valem para rodar sem Docker e podem ficar como estão):

- `SUPABASE_URL`: a URL do projeto do CRM, `https://<id-do-projeto>.supabase.co`.
- `SUPABASE_PUBLISHABLE_KEY`: a chave pública (`sb_publishable_...`), em Project Settings > API Keys no painel do projeto. Nunca a chave secreta: o sistema recusa.
- `POSTGRES_PASSWORD`: senha do banco local, só letras e números. Para gerar uma:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
```

Salve e feche o Bloco de Notas. O `.env` fica só neste PC e não vai para o GitHub.

## 5. Subir o sistema

```powershell
docker compose up -d --build
```

Na primeira vez ele baixa as imagens e monta a aplicação; leva alguns minutos. Confira:

```powershell
docker compose ps
```

`db` deve estar `healthy` e `app` `running`. Abra http://localhost:3000 e entre com o seu e-mail e senha do CRM. A Prospecção ainda vem vazia: falta carregar a base.

## 6. Carregar a base da Receita

Comece por um estado para medir o tempo nesta máquina. A carga roda solta da janela (o PowerShell pode ser fechado):

```powershell
docker compose run -d --name carga-cnpj app node importador/importar.js --ufs SP
docker logs -f carga-cnpj
```

- O `docker logs -f` mostra o andamento; `Ctrl+C` só para de mostrar. Pode levar horas, principalmente com o Docker num HD comum.
- **Não apague o `carga-cnpj` (`docker rm`) antes de aparecer `Publicado: N estabelecimentos`**: apagar no meio derruba a montagem.
- Desligue a suspensão do Windows enquanto roda (Configurações > Sistema > Energia).
- Mais de um estado: `--ufs SP,MG,RJ`. Sem `--ufs` vai o Brasil inteiro.
- Depois de `Publicado`, apague o registro: `docker rm carga-cnpj`.
- Se cair no meio do download, apague o registro e rode de novo. A base que estava publicada continua valendo até a nova terminar.

A Receita publica uma edição nova por mês. Para atualizar, rode o mesmo comando; ele pega a edição mais recente.

### Se a carga parar na montagem

Se os arquivos já foram baixados (no log aparecem os 34 `carregado em`) e ela parou depois, em `Montando a base final`, não precisa baixar de novo. Retome informando o mês da carga:

```powershell
docker rm carga-cnpj
docker compose run -d --name carga-cnpj app node importador/importar.js --ufs SP --mes 2026-10 --retomar
docker logs -f carga-cnpj
```

Para os arquivos baixados sobreviverem, o banco precisa ser parado com calma (o `docker-compose.yml` já dá 2 minutos para isso). Se for preciso parar só o banco à mão: `docker compose stop -t 120 db`.

### Migration nova da base de CNPJ num PC que já tem a base

As migrations de `db-local/migrations/` rodam sozinhas só na primeira subida. Uma migration nova, depois disso:

```powershell
docker compose cp db-local/migrations/<arquivo>.sql db:/tmp/m.sql
docker compose exec db psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/m.sql
```

## 7. Ligar o Google Maps

```powershell
docker compose --profile maps up -d
```

Depois disso a aba Google Maps aceita buscas: clique em "Nova busca pelo PC", no topo, ao lado de "Novo lead". Vá com calma no volume: muitas buscas seguidas fazem o Google bloquear o IP.

## 8. Abrir Prospecção e Google Maps no site da internet (opcional)

Sem este passo, Prospecção e Google Maps só abrem neste PC, em http://localhost:3000. Com ele, as duas abas aparecem também no site (por exemplo `https://allmed.4him.com.br`), em qualquer computador, **enquanto este PC estiver ligado com o Docker rodando**. Com o PC desligado, elas avisam que o PC está fora do ar; Kanban e Leads continuam funcionando.

O túnel sai deste PC para o Cloudflare: não abre porta no roteador. Quem chama a prospecção pelo túnel precisa estar logado no CRM.

**No Cloudflare**

1. No painel, vá em **Networking > Tunnels** e clique em **Create a tunnel**.
2. Dê um nome (por exemplo `all-med-pc`) e clique em **Create Tunnel**.
3. Na tela de instalação, escolha **Docker** (ou qualquer sistema) e copie só o código longo que vem depois de `--token` (ou de `install`). Esse código é segredo.

**Neste PC**, no `.env`:

```
TUNNEL_TOKEN=<o código copiado>
PC_HOST=allmed-pc.4him.com.br
WEB_URL=https://allmed.4him.com.br
```

E suba com o túnel junto:

```powershell
docker compose --profile maps --profile tunel up -d --build
```

**De volta ao Cloudflare**

1. A tela do túnel deve mostrar que ele conectou. Clique em **Continue**.
2. Em **Routes**, clique em **Add route** > **Published application**.
3. **Subdomain:** `allmed-pc`. **Domain:** `4him.com.br`. **Service URL:** `http://app:3000`. Clique em **Add route**.
4. No projeto do site (**Workers & Pages** > `all-med` > **Settings** > **Environment variables**), adicione `PC_URL` = `https://allmed-pc.4him.com.br` e publique de novo (**Deployments** > **Retry deployment**).

Use um subdomínio de um nível só (`allmed-pc.4him.com.br`, e não `pc.allmed.4him.com.br`): é o que o certificado gratuito do Cloudflare cobre.

Daí em diante, o dia a dia usa `--profile maps --profile tunel` nos comandos de subir, parar e atualizar.

## Usuários da equipe

Todos os usuários cadastrados trabalham nos mesmos leads e no mesmo kanban. No ícone de usuário, no canto do topo, cada um troca a própria senha e sai. Quem é **Administrador** também abre por ali **Usuários e acessos**, onde cadastra (nome, e-mail e papel), desativa e reativa pessoas e escolhe as telas de cada uma (veja "Acessos por tela", logo abaixo).

Quem foi cadastrado cria a própria senha: abre o sistema, clica em **Primeiro acesso? Crie sua senha**, digita o e-mail cadastrado e escolhe a senha. Isso vale uma vez só; depois, a senha muda pelo ícone de usuário. Escolha consciente: quem souber o e-mail de alguém que ainda não fez o primeiro acesso consegue criar a senha antes dele. A lista de usuários mostra quem está **Aguardando primeiro acesso**; se alguém ativar uma conta que não devia, desative a pessoa e cadastre de novo com outro e-mail.

Instalação, no painel do CRM online:

1. **Regras da equipe:** em **SQL Editor**, rode `supabase/migrations/20261103180000_equipe.sql` (se ainda não rodou) e depois `supabase/migrations/20261103210000_primeiro_acesso.sql`, cada um numa consulta nova (cole o conteúdo e clique em **Run**). Quem já tem conta vira Administrador.
2. **Função `usuarios`:** em **Edge Functions**, crie com **Deploy a new function** > **Via Editor** (ou abra a `usuarios`, se ela já existir), cole o conteúdo de `supabase/functions/usuarios/index.ts` no lugar do código e clique em **Deploy function** (ou **Deploy updates**). Nas configurações da função, **desligue a verificação de JWT**: o primeiro acesso é feito sem login, e a própria função confere o login de quem cadastra e desativa usuários.
3. **Tela:** aprove o PR no GitHub (o site atualiza sozinho) e, neste PC, rode `git pull` e `docker compose up -d --build app`.

Faça os três em sequência: com só uma parte no ar, o cadastro e o primeiro acesso dão erro.

Para desfazer: os scripts de volta estão no topo das duas migrations; a função se apaga em **Edge Functions**; e o código volta revertendo o PR.

## Buscas do PC entrando no mapa

Desde 12/11/2026, quando uma busca do Google termina, as empresas dela entram sozinhas no mapa da aba Google Maps, e a lista "Buscas feitas" mostra e exclui cada busca. Para ligar, nesta ordem:

1. No painel do CRM online, em **SQL Editor**, rode `supabase/migrations/20261112110000_maps_buscas_do_pc.sql` numa consulta nova. Ela deixa a equipe gravar as empresas das buscas e excluir uma busca.
2. Aprove o PR no GitHub. O site atualiza sozinho.
3. Neste PC, abra o sistema pelo .bat, que já faz `git pull` e sobe a versão nova, ou rode `git pull` e `docker compose --profile maps --profile tunel up -d --build`.

A ordem importa: sem o passo 1, a tela não consegue guardar as empresas, e a busca fica no PC com o aviso do erro. Nesse caso, não clique em "Tirar", senão o resultado se perde: rode a migration e abra a aba de novo.

Para desfazer: o script de volta está no topo da migration, e o código volta revertendo o PR. As empresas que já entraram no mapa continuam lá.

## Acessos por tela

Em **Usuários e acessos**, cada pessoa tem uma caixa por tela: Kanban, Leads, Prospecção, Google Maps e Clientes ativos. Marcar ou desmarcar grava na hora. Quem não tem a tela não vê a aba nem o botão dela, e o CRM online recusa os dados dela mesmo para quem tentar direto pela API. Administrador abre todas, sem caixa. Quem não tem nenhuma tela vê só o aviso para pedir acesso.

Ao instalar, quem já está na equipe recebe as cinco telas: nada muda até você desmarcar alguma. Quem for cadastrado depois começa sem nenhuma; marque as telas logo depois de cadastrar.

| Tela | O que ela abre no CRM online |
|---|---|
| Kanban, Leads | Ler, editar e arquivar os leads da equipe, o histórico e o botão Novo lead (qualquer uma das duas basta) |
| Prospecção | A base de CNPJ no PC; mandar empresas ao kanban; ler a lista de clientes ativos (para marcar quem já é cliente) |
| Google Maps | O mapa das empresas; as buscas novas pelo PC, guardar o resultado delas no mapa e excluir uma busca em "Buscas feitas"; mandar ao kanban; ler a lista de clientes ativos (para esconder quem já é cliente) |
| Clientes ativos | Cadastrar e tirar clientes; ler as empresas do mapa, para a coluna "Escondidas no mapa" |

Detalhes:

- Quem tem Prospecção ou Google Maps sem Kanban e sem Leads manda empresas para o kanban, mas só enxerga os leads que ele mesmo mandou. "No kanban" aparece só nesses; uma empresa que outra pessoa já mandou o banco ignora no envio, e o aviso conta como "já estava no CRM".
- O PC confere a tela antes de abrir a base de CNPJ (Prospecção) e as buscas do Google (Google Maps), e guarda a resposta por 1 minuto: uma tela tirada vale no PC em até 1 minuto. No site, a aba some quando a pessoa carrega a página de novo; os dados ela já não consegue ler na hora.
- O Painel gerencial, quando existir, aparece sozinho como mais uma coluna.

Instalação, nesta ordem:

1. **Banco:** em **SQL Editor**, numa consulta nova, cole o conteúdo de `supabase/migrations/20261112120000_acessos.sql` e clique em **Run**. Antes, a `20261112110000_maps_buscas_do_pc.sql` (seção anterior) precisa ter rodado: esta troca as regras de gravar e excluir buscas que ela cria.
2. **Site:** aprove o PR no GitHub (o site atualiza sozinho).
3. **PC:** rode `git pull` e o mesmo `up -d --build` de sempre (com `--profile tunel` se usa o túnel).

Se o site for atualizado antes do banco, ele mostra todas as abas, como antes. Se o PC for atualizado antes do banco, Prospecção e Google Maps respondem "Não consegui conferir o seu login agora" até a migration rodar.

Para voltar atrás: no topo da migration há um script de volta (as linhas que começam com `-- drop` e `-- create`). Copie essas linhas sem o `-- ` do começo e rode no **SQL Editor**: todo membro ativo volta a abrir todas as telas, e a tabela de acessos é apagada. Depois reverta o PR no GitHub e, no PC, volte o código como em "Voltar atrás". Só reverter o site e o PC não basta: o banco continua recusando os dados de quem não tem a tela, e as abas aparecem vazias.

## Dia a dia

- Com o Docker Desktop abrindo no login, o sistema sobe sozinho com o PC. É só abrir http://localhost:3000.
- A porta 3000 fica presa em 127.0.0.1. Para usar de fora, use o túnel do passo 8; não libere a porta na rede.
- Parar tudo: `docker compose --profile maps stop`. Voltar: `docker compose --profile maps up -d`.

## Painel gerencial

O Painel é a primeira aba de quem entra. Os números vêm de uma função do CRM online, então ele só aparece depois de instalar a função.

Instalação, nesta ordem:

1. **Banco:** em **SQL Editor**, numa consulta nova, cole o conteúdo de `supabase/migrations/20261112150000_painel_gerencial.sql` e clique em **Run**. A migration só cria a função `public.painel_gerencial`: não muda tabela nem dado, e roda em segundos.
2. **Site:** aprove o PR no GitHub (o site atualiza sozinho).
3. **PC:** rode `git pull` e o mesmo `up -d --build` de sempre (com `--profile tunel` se usa o túnel).

Se o site for atualizado antes do banco, o Painel abre com o aviso "O painel não carregou" e as outras abas seguem normais. Para conferir depois de rodar, entre no site: a frase do período e os números aparecem no lugar do aviso.

Para voltar atrás: no **SQL Editor**, rode `drop function public.painel_gerencial(timestamptz, timestamptz);` e reverta o PR no GitHub. Nenhum dado se perde, porque a função só lê.

## Atualizar o sistema

```powershell
git pull
docker compose --profile maps up -d --build
```

## Voltar atrás (rollback)

Se uma atualização der problema, volte o código para a versão anterior e suba de novo:

```powershell
git log --oneline -5
git checkout <código-da-versão-anterior>
docker compose --profile maps up -d --build
```

Para voltar à versão mais nova depois: `git checkout main` e o mesmo `up -d --build`.

Se a carga de um mês novo vier com problema, a base volta ao mês anterior com:

```powershell
docker compose exec db psql -U postgres -c "select cnpj_carga.reverter()"
```

Os leads, o kanban e o histórico ficam no CRM online e não são afetados por nada disso.

## Problemas comuns

- **"port is already allocated"**: outro programa usa a porta 3000 ou 5432. Feche o programa ou troque a porta da esquerda em `docker-compose.yml` (por exemplo `"127.0.0.1:3001:3000"`) e abra http://localhost:3001.
- **"Não consegui falar com o scraper"** na aba Google Maps: falta o passo 7.
- **Busca do Google Maps parada em "Na fila"**: veja o que o scraper está fazendo com `docker compose --profile maps logs --tail 50 scraper`.
- **"O PC da prospecção está desligado"** no site: o PC está desligado, sem internet, ou o túnel não subiu (`docker compose --profile tunel ps`).
- **PC com menos de 8 GB de RAM**: em `docker-compose.yml`, reduza `shared_buffers` para `256MB`, `effective_cache_size` para `1GB` e `maintenance_work_mem` para `256MB`, e rode `docker compose up -d` de novo.
- **Ver o que está acontecendo**: `docker compose logs -f app` (Ctrl+C sai do log, o sistema continua rodando).
- **Começar a base do zero**: `docker compose --profile maps down -v` apaga o banco local, a base de CNPJ e as buscas do Maps que ainda não foram mandadas ao kanban. O CRM online não é afetado. Depois, volte ao passo 5.
