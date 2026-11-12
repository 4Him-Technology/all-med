---
name: Leads Maps
description: CRM de leads de uma pessoa só, com prospecção por CNPJ e Google Maps
colors:
  bege-fundo: "#ece8e5"
  branco-cartao: "#ffffff"
  bege-fundo-2: "#e3ded9"
  bege-topo: "#f6f3f1"
  marinho-texto: "#0b1238"
  ardosia-apoio: "#545b78"
  borda-areia: "#d8d1cb"
  borda-areia-forte: "#c4bcb5"
  petroleo-destaque: "#4e90a7"
  petroleo-suave: "#dbeaf0"
  petroleo-acao: "#2f6b80"
  vermelho-perigo: "#b3261e"
  etapa-novo: "#5b6478"
  etapa-qualificado: "#4b4f9e"
  etapa-proposta: "#9a6a12"
  etapa-negociacao: "#b4541f"
  etapa-ganho: "#2e7d5b"
  segmento-laranja: "#c2571a"
  segmento-azul: "#2a6fb0"
  segmento-rosa: "#a8508c"
  segmento-roxo: "#6b3f8f"
  segmento-turquesa: "#12808f"
  segmento-ardosia: "#3d4663"
typography:
  marca:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  titulo:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  corpo:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  tabela:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  rotulo-coluna:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  pequeno: "8px"
  cartao: "12px"
  pilula: "99px"
spacing:
  gutter: "28px"
  cartao: "16px"
  linha-tabela: "12px 16px"
components:
  botao-primario:
    backgroundColor: "{colors.petroleo-acao}"
    textColor: "{colors.branco-cartao}"
    rounded: "{rounded.pequeno}"
    padding: "8px 16px"
  botao-primario-hover:
    backgroundColor: "{colors.marinho-texto}"
  botao:
    backgroundColor: "{colors.branco-cartao}"
    textColor: "{colors.marinho-texto}"
    rounded: "{rounded.pequeno}"
    padding: "8px 16px"
  grupo-filtro-aberto:
    backgroundColor: "{colors.petroleo-suave}"
    textColor: "{colors.marinho-texto}"
    rounded: "{rounded.pequeno}"
  etiqueta-filtro:
    backgroundColor: "{colors.petroleo-suave}"
    textColor: "{colors.marinho-texto}"
    rounded: "{rounded.pilula}"
  botao-segmento:
    backgroundColor: "{colors.branco-cartao}"
    textColor: "{colors.marinho-texto}"
    rounded: "{rounded.pilula}"
    padding: "3px 10px 3px 9px"
  botao-segmento-ligado:
    backgroundColor: "{colors.petroleo-suave}"
    textColor: "{colors.marinho-texto}"
    rounded: "{rounded.pilula}"
  barra-lote:
    backgroundColor: "{colors.marinho-texto}"
    textColor: "{colors.branco-cartao}"
    rounded: "{rounded.cartao}"
    padding: "10px 10px 10px 20px"
  cartao:
    backgroundColor: "{colors.branco-cartao}"
    rounded: "{rounded.cartao}"
---

# Design System: Leads Maps

## Overview

**Creative North Star: "A mesa de trabalho de quem prospecta sozinho"**

Um sistema de trabalho, não uma vitrine. Cada tela serve para achar empresas, escolher várias de uma vez e agir, sem janela por cima da lista. O mundo visual vem de clínica de saúde ocupacional: bege claro de fundo, azul-marinho no texto e azul-petróleo como única cor de ação, sempre em tema claro.

A densidade é de planilha arrumada: tabelas de 14px, cartões brancos com sombra fina sobre o bege, e cor reservada para estado (etapa do lead, situação da empresa, tipo de telefone). O movimento só aparece quando algo muda de estado.

**Key Characteristics:**
- Tema claro fixo, sem modo escuro.
- Uma cor de ação (petróleo); o resto da cor diz estado.
- Ações em lote numa barra escura fixa embaixo.
- No Google Maps o mapa é a tela: um mapa só com todas as empresas, e a lista ao lado mostra o que está na área dele.
- A palavra Supabase não aparece em lugar nenhum da interface.

## Colors

Bege quente de fundo, cartões brancos, texto azul-marinho e um petróleo para ação e foco. Todas as combinações de texto passam no contraste AA (4,5:1).

### Primary
- **Petróleo de ação** (#2f6b80): botão principal, link, pino marcado no mapa das buscas do PC, seta da coluna ordenada.
- **Petróleo de destaque** (#4e90a7): borda do topo, sublinhado da aba atual, borda do grupo de filtro aberto. Não é usado em texto pequeno.
- **Petróleo suave** (#dbeaf0): fundo do grupo de filtro aberto, das etiquetas de filtro e da aba atual.

### Neutral
- **Bege de fundo** (#ece8e5): fundo da página.
- **Branco de cartão** (#ffffff): cartões, tabelas, painéis, ficha.
- **Bege do topo** (#f6f3f1): topo fixo, cabeçalho de tabela, rodapé de cartão.
- **Marinho** (#0b1238): texto, e fundo da barra de lote e do aviso flutuante.
- **Ardósia** (#545b78): texto de apoio, rótulos de coluna.
- **Areia** (#d8d1cb / #c4bcb5): bordas e divisórias.

### Cores de estado
- **Etapas do lead**: novo #5b6478, contato #2f6b80, qualificado #4b4f9e, proposta #9a6a12, negociação #b4541f, ganho #2e7d5b, perdido #b3261e. A pílula usa a cor no texto e a mesma cor a 13% no fundo.
- **Já no kanban**: ganho #2e7d5b, no texto "No kanban" e no pino do mapa (pino cheio nas buscas do PC; aro verde com miolo branco no mapa das empresas). O mesmo verde marca "Cliente ativo" na Prospecção.
- **Marcada no mapa das empresas**: anel marinho #0b1238 em volta do pino ou do círculo do grupo.

### Cores de segmento (mapa das empresas)
No mapa das empresas a cor do pino diz o segmento, na ordem alfabética dos segmentos: laranja #c2571a, azul #2a6fb0, rosa #a8508c, roxo #6b3f8f, turquesa #12808f e, se houver mais segmentos, ocre #9a6a12 e ardósia #3d4663. A mesma cor aparece na bolinha do botão do segmento, da linha da lista e da ficha, que servem de legenda. O verde fica de fora da lista porque no mapa já quer dizer "no kanban", e a ardósia fica por último porque, na borda de um círculo, se parece com o anel marinho de "marcada".

### Cores de dado (Painel)
Cada gráfico do Painel tem uma série só, então não tem legenda: o título diz o que está desenhado. A barra de dado é petróleo de destaque #4e90a7 (3,6:1 sobre o branco) e a coluna apontada ou com foco fica petróleo de ação #2f6b80. Nos medidores, o trilho é o petróleo suave #dbeaf0. No funil, que é uma sequência, todas as etapas têm o mesmo tom e só a barra de Ganho fica verde #2e7d5b: as cores das etapas do kanban, lado a lado, ficam parecidas demais para servir de barra (o validador da skill dataviz reprovou: vizinhas com ΔE 5, abaixo do piso de 15). A comparação com o período anterior usa o verde de ganho com a seta para cima e o vermelho de perigo com a seta para baixo, sempre com o texto ("12 a mais"); igual fica em ardósia.

### Named Rules
**A regra da cor que diz estado.** Fora o petróleo de ação, toda cor na tela significa um estado (etapa, situação, tipo de telefone, já enviado), no mapa das empresas o segmento, e no Painel o dado de uma série só. Cor decorativa não entra.

## Typography

**Fonte única:** Montserrat (com system-ui de reserva), pesos 400, 500, 600 e 700.

**Character:** geométrica e limpa; a hierarquia vem de peso e tamanho, nunca de outra família.

### Hierarchy
- **Marca** (700, 21px, -0.02em): "Leads Maps" no topo, com "Maps" em petróleo de destaque e peso 500.
- **Título** (600, 21px, 1.25): nome do lead ou da empresa na ficha.
- **Corpo** (400, 15px, 1.5): texto geral.
- **Tabela** (400, 14px): linhas de lista; nome da empresa em 600.
- **Rótulo de coluna** (600, 11px, 0.06em, maiúsculas): cabeçalho das tabelas e títulos de seção da ficha.

## Layout

Página com margem de 28px (16px no celular), topo fixo com a marca, as abas e a conta. Listas ocupam a largura toda; quando há algo para ler ao lado (ficha do lead, mapa da busca) a tela vira duas colunas: lista flexível e painel fixo de 470px (ficha) ou 440px (mapa). Na Prospecção, os filtros ficam num menu de 300px à esquerda da lista. No Google Maps a tela é o mapa: ele ocupa a altura que sobra abaixo do topo, sem rolar a página, com um painel de 360 a 460px à esquerda (busca, segmentos, filtros e lista, que rola por dentro).

Abaixo de 1280px as abas descem para uma segunda linha do topo (numa linha só, marca, seis abas e os três botões não cabem) e o mapa das empresas encolhe o mesmo tanto; abaixo de 1100px a ficha do lead abre na gaveta e o e-mail da conta sai do topo; abaixo de 900px o mapa das buscas do PC desce para baixo da lista e o mapa das empresas sobe para cima do painel (e quem rola passa a ser a página); abaixo de 720px tudo vira uma coluna, botões e campos ganham 44px de altura e os segmentos ficam numa linha que rola para o lado. Tabelas largas rolam para o lado dentro do próprio cartão, nunca a página.

## Elevation & Depth

Profundidade por sombra em camadas, sempre suave e azulada (rgb 11 18 56), sem borda nos cartões.

### Shadow Vocabulary
- **Fina** (`0 0 0 1px rgb(11 18 56 / .06), 0 1px 2px -1px rgb(11 18 56 / .08), 0 2px 4px rgb(11 18 56 / .04)`): cartões, tabelas, menu de filtros, ficha ao lado.
- **Média** (`0 6px 18px rgb(11 18 56 / .1)`): lista de sugestões dos campos de busca.
- **Alta** (`0 18px 48px rgb(11 18 56 / .18)`): o que flutua por cima (barra de lote, gaveta, aviso).

## Shapes

Cantos de 12px em cartões e painéis, 8px em botões e campos, pílula (99px) em etiquetas de filtro, pílulas de etapa e pinos do mapa. Sem bordas grossas nem cantos retos.

## Components

### Botões
- **Forma:** 8px, altura mínima 38px (44px no celular), aperta para 0,97 ao clicar.
- **Primário:** fundo petróleo #2f6b80, texto branco 600; no hover fica marinho.
- **Padrão:** fundo branco, borda areia forte; no hover fundo bege e borda petróleo.
- **Em andamento:** desabilitado com ícone girando e o texto da ação ("Mandando…").

### Menu de filtros (Prospecção)
- Menu lateral de 300px à esquerda, fixo ao rolar a página e com rolagem própria. Cada grupo é uma seção que abre e fecha, com a contagem dos filtros ligados e a seta; Localização e Ramo começam abertos, e vários podem ficar abertos juntos.
- O Buscar fica preso no pé do menu, com o aviso de erro logo acima dele.
- Na coluna da lista, o total da busca e uma etiqueta por filtro ligado; o x tira o filtro e refaz a busca na hora.
- Abaixo de 900px o menu sobe para cima da lista, sem ficar fixo.

### Mapa das empresas (Google Maps)
- **Painel:** busca por nome, categoria ou endereço; um botão em pílula por segmento, com a bolinha da cor e a contagem (ligado fica petróleo suave); três botões de filtro (Região, Categoria, Mais filtros) que abrem um painel por cima da lista, um por vez, e fecham com Esc ou clique fora; etiquetas com x para o que está ligado e "Limpar filtros".
- **Lista:** total do filtro ou "N de M empresas nesta área do mapa" com "Ver todas"; "Marcar todas" e a ordem (por nome ou maior nota). Cada linha tem a caixa de marcar, o nome com a bolinha do segmento, a nota e, embaixo, categoria e telefone. As linhas entram de 60 em 60 ao rolar.
- **Mapa:** pino redondo de 16px na cor do segmento; pinos próximos viram um círculo branco com a contagem e a borda na cor do segmento (cinza quando mistura segmentos, verde quando todas já estão no kanban); clicar no círculo aproxima. A linha apontada na lista ganha um anel marinho no mapa.
- **Ficha:** abre no mapa, no lugar da empresa, ao clicar na linha ou no pino: nome, segmento e categoria, nota, endereço, telefone com o tipo deduzido, WhatsApp, Site, Google Maps e o botão Marcar para o kanban. Com o clique, o anel chega fechando sobre o lugar em 220ms; pelo teclado não anima, o foco entra na ficha e o Esc o devolve à linha.
- **Envio:** a barra de lote fica no pé do mapa (presa embaixo da janela no celular). Acima de 50 empresas o botão vira "Confirmar: mandar N para o kanban" e só manda no segundo clique.
- **Nova busca pelo PC:** botão branco no topo, à esquerda de Novo lead, só onde há o PC e com login; de qualquer aba, abre a aba Google Maps com a janela da nova busca por cima do mapa. No celular fica só o ícone de busca.
- **Faixa das buscas:** entre os filtros e o resumo do painel. Cada busca rodando no PC é uma linha bege com a barra de andamento; a que entrou no mapa é uma linha verde suave com o que entrou, o que ficou de fora, "Ver no mapa" e o x para fechar; a que parou com erro é vermelha suave, com "Tirar". Cada linha entra surgindo (220ms) só quando muda; a conferência a cada 5s não refaz nada que não mudou. Embaixo, o botão "Buscas feitas".
- **Buscas feitas:** popup largo com a tabela Busca (segmento e, embaixo, o local), Empresas (e quantas no kanban), Guardada em e os botões Ver no mapa e Excluir. Excluir pede um segundo clique ("Confirmar" em vermelho) e o foco segue para a próxima busca. No celular cada busca vira um bloco, com os dois botões lado a lado embaixo.
- **Parece cliente:** etiqueta âmbar (a cor de "Aguardando", porque é um aviso inferido, não um fato) na segunda linha da empresa; na ficha, uma caixa âmbar com o nome do cliente e "Confira antes de mandar ao kanban". O painel diz quantas são.

### Nova busca (janela "Nova busca pelo PC")
- Popup largo com o título, a explicação de que as empresas entram no mapa sozinhas e o formulário sem cartão em volta: Ramo (vários separados por vírgula), Cidade, Bairro opcional e o botão Iniciar busca, na mesma linha. Cada ramo vira uma busca "ramo em bairro, cidade" para o scraper, e no mapa um segmento.
- Sem o CRM online (só o PC), o mesmo formulário fica no alto da aba, acima dos cartões das buscas.

### Clientes ativos
- Cartão branco com o cadastro numa linha (campo "Cadastrar cliente" e botão primário) e a explicação de como o cliente é reconhecido; embaixo, o total e a busca na lista, e a tabela com Cliente, Escondidas no mapa (o que a regra reconheceu, ou "Nenhuma" em cinza) e o botão Tirar.
- Tirar pede um segundo clique: o botão vira "Confirmar" em vermelho e volta ao normal quando perde o foco.
- Nas pesquisas, o cliente reconhecido some do mapa e das buscas do PC; na Prospecção leva a etiqueta "Cliente ativo" em verde (o mesmo de "No kanban": já é ganho) no lugar da caixa de marcar.
- Largura máxima de 1100px, alinhada à esquerda.

### Painel
- Primeira aba de quem abre o Painel (o administrador sempre, os outros quando liberados); para quem não abre, a aba some. Relatório numa coluna de leitura de até 1000px, alinhada à esquerda, com cinco cartões brancos em sequência: a frase do período, Atividade, Funil, Onde rende e Precisa de atenção. Nenhum cartão dentro de outro; as tabelas de dentro levam só o contorno de areia.
- **Período:** uma linha acima de tudo, com cinco botões num grupo branco (7 dias, 30 dias, 90 dias, 12 meses, Desde o começo); o escolhido fica petróleo suave, com aria-pressed, e o navegador lembra a escolha. À direita, "Atualizado às 14:38". O período vale para a frase, a Atividade e o Funil; Onde rende diz "desde o começo" e Precisa de atenção diz "hoje", na nota cinza embaixo do título.
- **A frase do período:** título de 24px (21px no celular) montado dos números ("46 contatos e 36 leads novos nos últimos 30 dias."), a linha cinza com a comparação e os parados, e o link "Ver os parados", que leva o foco ao último cartão. Embaixo, "Setas: comparação com os 30 dias anteriores." e seis números em grade (seis colunas, três abaixo de 900px, duas no celular): rótulo de 13px, valor de 26px em 600 sem algarismos tabulares, e a diferença curta embaixo.
- **Gráfico de colunas:** uma coluna por dia (até 31 dias), semana (até uns 6 meses) ou mês; barra de no máximo 24px com a ponta de 4px arredondada, 2px de vão entre colunas e uma linha de base de areia forte. A coluna inteira é o alvo do ponteiro e ganha um fundo de petróleo a 9%. O valor aparece na linha do título ("4 em 01/11"), no lugar do total; sem o ponteiro, o título mostra o total e o dia mais alto. O gráfico é uma parada de Tab só, e as setas, Home e End andam entre as colunas. Embaixo, "Ver os números em tabela" abre a mesma série numa tabela.
- **Medidores** (tipos de contato, segmentos, locais da busca): nome, trilho de 8px e o número numa coluna de largura fixa, para os trilhos terem o mesmo tamanho em todas as linhas; no celular a barra desce para baixo do nome.
- **Funil:** barra de 20px que nasce da esquerda, com o número e a conversão da etapa anterior ao lado ("21 · 58% de Novo"); embaixo, a taxa de ganho, perdidos e em aberto, e a tabela "De onde vieram".
- **Precisa de atenção:** as quatro faixas de tempo sem contato em números, a tabela dos 10 parados há mais tempo (o nome abre a ficha do lead na gaveta), as pílulas de etapa com a quantidade de hoje e as etiquetas de temperatura.
- **Estados:** esqueleto na primeira carga; ao trocar o período, o painel anterior fica a 55% até o novo chegar, sem pular a tela; erro e "sem acesso" no bloco de estado com "Tentar de novo"; sem dado, cada cartão diz o que falta em vez de mostrar zero desenhado. O único movimento é a chegada dos números da primeira vez (aparecer, 220ms).

### Barra de lote
- Barra marinho fixa no centro de baixo, com a contagem, "Limpar" e o botão branco "Mandar N para o kanban". Aparece com a primeira empresa marcada, entra subindo 12px em 220ms. Enquanto está na tela o aviso flutuante sobe para não ficar por baixo.

### Tabelas
- Cabeçalho bege do topo com rótulo de coluna; linha marcada com petróleo a 10%; "No kanban" em verde no lugar da caixa de marcar.
- Leads: o título da coluna ordena; a coluna ordenada mostra a seta em petróleo e aria-sort.

### Conta e usuários
- Ícone de usuário redondo no canto direito do topo. Abre um menu (popover nativo, fecha com Esc e clique fora) com nome e e-mail, Trocar senha, Usuários e acessos (só admin) e Sair.
- Usuários e acessos é um popup largo (1120px): formulário de uma linha (Nome, E-mail, Papel, Cadastrar) e a lista com Pessoa (nome e, embaixo, o e-mail), Papel, a situação em pílula (Ativo verde, Aguardando primeiro acesso âmbar, Desativado vermelho), uma coluna por tela com a caixa de marcar no meio e o botão Desativar ou Reativar.
- As colunas de tela são as abas do topo, com o mesmo nome; aba nova entra sozinha. Na linha do administrador, as caixas dão lugar a "Abre todas as telas". Marcar grava na hora, com o aviso "Bruno agora abre Leads"; se o banco recusar, a caixa volta e o aviso diz o erro. Pelo teclado, o foco fica na caixa.
- A aba e o botão (Novo lead, Nova busca pelo PC) de tela não liberada somem do topo. Sem nenhuma tela, fica só o aviso para pedir acesso ao administrador.
- Login com dois cartões que se alternam: Entrar e Primeiro acesso (o e-mail digitado passa de um para o outro).

### Ficha ao lado (Leads)
- Painel branco fixo de 470px que entra deslizando, rola por dentro e fecha no x ou com Esc. É o mesmo conteúdo da gaveta do kanban.

### Cartão de busca do PC (Google Maps, só sem o CRM online)
- Título com seta, nome, status e resumo; a busca rodando mostra uma barra de andamento que só indica atividade (o scraper não informa porcentagem).
- Aberto, mostra a lista com número e o mapa com pinos do mesmo número: branco não marcado, petróleo marcado, verde já no kanban. Clicar no pino marca a empresa. O mapa é em tons de cinza (OpenStreetMap com filtro) para os pinos aparecerem.

## Do's and Don'ts

### Do:
- **Do** usar o petróleo #2f6b80 só para ação, foco e o que está marcado.
- **Do** mandar várias de uma vez pela barra de lote em toda lista de empresas.
- **Do** manter o kanban como está; telas novas não mexem nele.
- **Do** animar só mudança de estado, de 140 a 220ms com ease-out, e nada quando a ação vem do teclado.

### Don't:
- **Don't** escrever "Supabase" em nenhum texto da interface; use "CRM online".
- **Don't** abrir janela por cima da lista para ver um item quando há espaço para o painel ao lado.
- **Don't** usar modo escuro nem trocar a Montserrat por outra família.
- **Don't** inventar número de andamento, total ou métrica que o sistema não tem.
