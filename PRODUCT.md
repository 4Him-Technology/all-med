# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O Filipe e uma equipe pequena de vendas (B2B). Cada pessoa tem o próprio login, a equipe trabalha os mesmos leads e o administrador escolhe quais telas cada um abre (por exemplo, quem só prospecta fica com Prospecção e Google Maps). O uso principal é no computador, sentado, montando listas de empresas e trabalhando o funil; o celular é secundário.

## Product Purpose

Encontrar empresas para prospectar e acompanhar cada uma até fechar ou descartar. Dois caminhos de entrada: a base de CNPJ da Receita Federal (filtros por localização, CNAE, situação, porte, regime, natureza jurídica, abertura, capital, contato e sócios) e buscas no Google Maps. As empresas escolhidas viram leads num kanban de acompanhamento, com histórico de atendimentos registrados à mão. Sucesso é montar uma lista qualificada em minutos e não perder nenhum follow-up.

## Positioning

Junta, num lugar só e sem IA, a pesquisa profunda de empresas que ferramentas como o ProspectandoB2B fazem num programa de Windows com o acompanhamento de funil de um CRM. A prospecção roda no computador da pessoa (a base de 70 milhões de estabelecimentos fica no Docker local, sem custo de nuvem) e o CRM fica online.

## Operating Context

- Parte local (PC com Docker): prospecção na base de CNPJ, importador mensal da Receita, scraper do Google Maps.
- Parte online (site estático + banco com login): kanban, lista de leads, ficha do lead e histórico.
- O fluxo diário: filtrar empresas, mandar as boas para a coluna Novo, ligar ou mandar mensagem, registrar o atendimento, mover o card pelas colunas (Novo, Em contato, Qualificado, Proposta, Negociação, Ganho, Perdido).
- A captação (prospecção e contatos) é feita por uma pessoa só (Filipe, 12/11/2026). A gerência acompanha o trabalho dela pelo Painel gerencial, a primeira tela de quem entra, sem placar por pessoa.

## Capabilities and Constraints

- Funciona hoje: prospecção com todos os filtros (dados de demonstração até a base real ser carregada), envio ao kanban sem duplicar, kanban com arrastar e teclado, lista de leads, ficha com histórico imutável, arquivamento, buscas no Google Maps (rodam no PC com Docker; com o túnel, começam também pelo site), mapa das empresas do Google Maps guardadas no CRM online (abre também no site; cada busca do PC entra nele sozinha quando termina, e a lista "Buscas feitas" mostra e exclui cada busca), lista de clientes ativos que some das pesquisas (reconhecida pelo nome, porque a lista do cliente só tem a razão social), com aviso "Parece cliente" no mapa para nome parecido, acessos por tela escolhidos pelo administrador (o banco e o PC também recusam, não só a tela).
- Restrições: o fornecedor do banco não pode aparecer em nenhum texto da interface. Sessão de login no sessionStorage (site estático). Dados de sócios e contatos de empresário individual são dado pessoal (LGPD).
- Decisões em aberto: nome do produto (ideias: Garimpo, Radar, Prospecta, Rota, Lastro); se a equipe vai precisar ver leads uns dos outros; exportação de listas para Excel/CSV.

## Brand Commitments

- Identidade visual baseada no site allmedocupacional.com.br (pedido explícito do Filipe): a paleta e o caráter tipográfico daquele site são ponto de partida obrigatório; sem usar logo, nome ou conteúdo da marca de referência.
- Projeto pessoal do Filipe, sem vínculo com a APSIS.

## Evidence on Hand

- Dados reais: 2.286 empresas de uma pesquisa no Google Maps (Zona Oeste de São Paulo, Osasco, Barueri, Jundiaí e Cajamar) estão no CRM online desde 10/11/2026; em 11/11/2026 nenhuma tinha virado lead. A prospecção roda com 5 empresas fictícias (test/cnpj-fixture.js) até a base da Receita ser carregada.
- Não inventar clientes, depoimentos, números de base ou preços.

## Product Principles

1. A tarefa vem antes do enfeite: a pessoa está trabalhando, não visitando.
2. Nenhum follow-up perdido: o próximo passo de cada lead tem de estar à vista.
3. Origem sempre rastreável: todo lead diz de onde veio e quando.
4. Dado honesto: a tela avisa quando um dado é inferido (celular, e-mail de contabilidade, sócio fundador) ou de demonstração.

## Accessibility & Inclusion

WCAG 2.2 AA (exigência do Filipe em todos os projetos): navegação por teclado, contraste adequado, rótulos em campos, foco visível, movimento reduzido respeitado.
