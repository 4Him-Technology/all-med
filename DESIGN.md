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
- Lista e mapa numerados igual no Google Maps.
- A palavra Supabase não aparece em lugar nenhum da interface.

## Colors

Bege quente de fundo, cartões brancos, texto azul-marinho e um petróleo para ação e foco. Todas as combinações de texto passam no contraste AA (4,5:1).

### Primary
- **Petróleo de ação** (#2f6b80): botão principal, link, pino marcado no mapa, seta da coluna ordenada.
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
- **Já no kanban**: ganho #2e7d5b, no texto "No kanban" e no pino do mapa.

### Named Rules
**A regra da cor que diz estado.** Fora o petróleo de ação, toda cor na tela significa um estado (etapa, situação, tipo de telefone, já enviado). Cor decorativa não entra.

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

Página com margem de 28px (16px no celular), topo fixo com a marca, as abas e a conta. Listas ocupam a largura toda; quando há algo para ler ao lado (ficha do lead, mapa da busca) a tela vira duas colunas: lista flexível e painel fixo de 470px (ficha) ou 440px (mapa).

Abaixo de 1100px a ficha do lead abre na gaveta e o e-mail da conta sai do topo; abaixo de 900px o mapa desce para baixo da lista e as abas descem para uma segunda linha do topo; abaixo de 720px tudo vira uma coluna e botões e campos ganham 44px de altura. Tabelas largas rolam para o lado dentro do próprio cartão, nunca a página.

## Elevation & Depth

Profundidade por sombra em camadas, sempre suave e azulada (rgb 11 18 56), sem borda nos cartões.

### Shadow Vocabulary
- **Fina** (`0 0 0 1px rgb(11 18 56 / .06), 0 1px 2px -1px rgb(11 18 56 / .08), 0 2px 4px rgb(11 18 56 / .04)`): cartões, tabelas, barra de filtros, ficha ao lado.
- **Média** (`0 6px 18px rgb(11 18 56 / .1)`): lista de sugestões dos campos de busca.
- **Alta** (`0 18px 48px rgb(11 18 56 / .18)`): o que flutua por cima (painel do grupo de filtro, barra de lote, gaveta, aviso).

## Shapes

Cantos de 12px em cartões e painéis, 8px em botões e campos, pílula (99px) em etiquetas de filtro, pílulas de etapa e pinos do mapa. Sem bordas grossas nem cantos retos.

## Components

### Botões
- **Forma:** 8px, altura mínima 38px (44px no celular), aperta para 0,97 ao clicar.
- **Primário:** fundo petróleo #2f6b80, texto branco 600; no hover fica marinho.
- **Padrão:** fundo branco, borda areia forte; no hover fundo bege e borda petróleo.
- **Em andamento:** desabilitado com ícone girando e o texto da ação ("Mandando…").

### Barra de filtros (Prospecção)
- Cada grupo é um botão com contagem dos filtros ligados e seta; abre um painel de 360px por cima da lista, um grupo por vez. Fecha ao clicar fora ou com Esc, e o foco volta ao botão.
- Logo abaixo, o total da busca e uma etiqueta por filtro ligado; o x tira o filtro e refaz a busca na hora.

### Barra de lote
- Barra marinho fixa no centro de baixo, com a contagem, "Limpar" e o botão branco "Mandar N para o kanban". Aparece com a primeira empresa marcada, entra subindo 12px em 220ms. Enquanto está na tela o aviso flutuante sobe para não ficar por baixo.

### Tabelas
- Cabeçalho bege do topo com rótulo de coluna; linha marcada com petróleo a 10%; "No kanban" em verde no lugar da caixa de marcar.
- Leads: o título da coluna ordena; a coluna ordenada mostra a seta em petróleo e aria-sort.

### Ficha ao lado (Leads)
- Painel branco fixo de 470px que entra deslizando, rola por dentro e fecha no x ou com Esc. É o mesmo conteúdo da gaveta do kanban.

### Cartão de busca (Google Maps)
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
