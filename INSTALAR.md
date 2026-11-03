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

Comece por um estado para medir o tempo nesta máquina:

```powershell
docker compose run --rm app node importador/importar.js --ufs SP
```

- Deixe a janela aberta até aparecer `Publicado: N estabelecimentos`. Pode levar horas.
- Desligue a suspensão do Windows enquanto roda (Configurações > Sistema > Energia).
- Mais de um estado: `--ufs SP,MG,RJ`. Sem `--ufs` vai o Brasil inteiro.
- Se cair no meio, rode o mesmo comando de novo. A base que estava publicada continua valendo até a nova terminar.

A Receita publica uma edição nova por mês. Para atualizar, rode o mesmo comando; ele pega a edição mais recente.

## 7. Ligar o Google Maps

```powershell
docker compose --profile maps up -d
```

Depois disso a aba Google Maps aceita buscas. Vá com calma no volume: muitas buscas seguidas fazem o Google bloquear o IP.

## Dia a dia

- Com o Docker Desktop abrindo no login, o sistema sobe sozinho com o PC. É só abrir http://localhost:3000.
- A tela só abre neste PC (fica presa em 127.0.0.1, porque não tem login próprio). Não libere a porta na rede.
- Parar tudo: `docker compose --profile maps stop`. Voltar: `docker compose --profile maps up -d`.

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
- **PC com menos de 8 GB de RAM**: em `docker-compose.yml`, reduza `shared_buffers` para `256MB`, `effective_cache_size` para `1GB` e `maintenance_work_mem` para `256MB`, e rode `docker compose up -d` de novo.
- **Ver o que está acontecendo**: `docker compose logs -f app` (Ctrl+C sai do log, o sistema continua rodando).
- **Começar a base do zero**: `docker compose --profile maps down -v` apaga o banco local, a base de CNPJ e as buscas do Maps que ainda não foram mandadas ao kanban. O CRM online não é afetado. Depois, volte ao passo 5.
