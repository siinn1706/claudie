# Claudie

Made by [Nguyễn Văn Nam](https://github.com/siinn1706). A fork of [Claudinho](https://github.com/Lu1sR0/claudinho) by [Luis Roberto](https://luisrobertoportifolio.com): a Windows desktop app that talks to your local **Claude Code** through the official Agent SDK and draws the chat over live ASCII wallpapers. This fork adds an **English** and **Vietnamese** interface next to the original Portuguese.

Do Nguyễn Văn Nam thực hiện. Bản fork của Claudinho, thêm giao diện **tiếng Anh** và **tiếng Việt** bên cạnh tiếng Bồ Đào Nha gốc.

## Language / Ngôn ngữ

Customize → General → Language (Tùy chỉnh → Chung → Ngôn ngữ): Português, English, Tiếng Việt. The default is Tiếng Việt, and switching applies right away. Claude replies in whatever language you write in, and the titles and news it writes for the app follow the interface language.

How it works: the code stays in Portuguese. [`src/renderer/i18n/i18n.js`](src/renderer/i18n/i18n.js) swaps each visible text node and the title/placeholder/aria-label/alt attributes using the dictionaries in [`src/renderer/i18n/parts/`](src/renderer/i18n/parts/), keyed by the Portuguese text, with `{0}` for values that change. Your messages, Claude's replies and code are never touched. The main process uses the same dictionaries for native dialogs and exports ([`src/i18n.js`](src/i18n.js)). To translate a new string, add its Portuguese text as a key in a parts file.

## Run / Chạy

1. Install [Claude Code](https://code.claude.com/docs/en/setup) and sign in.
2. Download `Claudie-Setup.exe` from [Releases](https://github.com/siinn1706/claudie/releases/latest) and run it (it is not code-signed, so SmartScreen asks first: More info → Run anyway). Or, from source: `npm install`, then `npm start`. Windows 10 or 11.

**Sign-in:** by default the app uses your Claude Code login (your plan). Anthropic's Agent SDK docs say third-party apps should not offer claude.ai login without approval, so read [the note in the SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and decide for yourself. Customize → General → Account lets you use an **Anthropic API key** instead (billed per use, encrypted by the OS).

Not affiliated with or endorsed by Anthropic. Claude, Claude Code and Clawd are trademarks of Anthropic.

## License

[MIT](LICENSE). Copyright (c) 2026 Nguyễn Văn Nam for Claudie, and Copyright (c) 2026 Luis Roberto for the original Claudinho code it builds on; both notices stay in the license, as MIT requires.

---

*The original Claudinho documentation (in Portuguese) follows.*

O seu Claude Code, agora com mais vida. Um app de desktop que conversa com o **Claude Code** de verdade (pelo SDK oficial de agentes) e desenha a conversa sobre papéis de parede ASCII vivos, com o Clawd do seu lado: 15 temas animados com música e sons, 278 animações da biblioteca ASCII Magic, papéis de parede do Wallpaper Engine, vídeos, imagens e GIFs seus.

Site do original: [meuclaudinho.com.br](https://meuclaudinho.com.br) · Feito por [Luis Roberto](https://luisrobertoportifolio.com)

**Como entra no Claude**: por padrão, com o login do próprio Claude Code (o seu plano). Em Personalizar → Geral → Conta dá pra usar uma **chave de API da Anthropic** no lugar (cobrada por uso); a chave fica cifrada pelo sistema.

## Desenvolver

```bash
npm install
npm start          # abre o app
npm run dist       # gera o instalador em dist/
```

## Como usar

- **Pasta do projeto** (barra lateral): a pasta onde o Claude Code trabalha.
- **Conversas**: "Todas" mostra as conversas do Claude Code de todos os projetos (as do terminal, do app do Claude na aba Code e das outras janelas), com o nome do projeto em cada uma; "Esta pasta" mostra só as da pasta atual. A lista sincroniza sozinha quando qualquer conversa muda, e o botão ⟳ força na hora. Abrir uma conversa de outro projeto leva a janela para a pasta dele. As conversas do claude.ai (chat da web/app) não aparecem: elas ficam nos servidores da Anthropic, sem acesso oficial.
- **Modelo e permissões**: escolha na barra lateral. Em "Perguntar", cada ferramenta que precisa de aprovação aparece como um cartão com Permitir, Sempre nesta sessão e Negar. O campo "Diga ao Claude o que fazer em vez disso" no cartão vai junto do Negar como recado. Quando o Claude apresenta um plano (modo plano), o cartão mostra o plano em Markdown e deixa aprovar em Perguntar, Editar sem perguntar ou Automático, ou continuar planejando com um ajuste.
- **Escolhas por conversa**: modelo, permissão, esforço e Ultracode ficam guardados em cada conversa (uma conversa nova começa com a última escolha feita numa nova) e valem na hora no turno que estiver rodando; o que o Claude Code não aceitar no meio do turno vale a partir da próxima mensagem.
- **Temas**: peça ao Claude (*"deixa o chat com a Honu Lagoon"*), digite `/tema`, `/tema lareira`, `/tema padrão`, ou use o botão 🎨 Temas.
- **Biblioteca**: a aba Biblioteca do seletor tem 278 animações da [ASCII Magic](https://www.ascii-magic.com/ascii) (MIT), de 9 categorias: paisagens, cidades, cosmos, clima e natureza, animais, algoritmos, arcade, datas e mascotes (a lista fica em `tools/indice-magia.mjs`), com busca e categorias. `/fundo gato` abre a busca; o Claude também procura e aplica (*"põe um fundo de chuva"*).
- **Meus**: crie no [ASCII Motion](https://www.ascii-motion.com), exporte como JSON e importe (botão, `/importar` ou arrastando o arquivo para a aba). Sessões `.asciimtn` sem camadas também entram.
- **Anexos**: clipe no campo de mensagem, arrastar arquivos para a janela ou colar imagens (Ctrl+V). Imagens vão para o Claude (as grandes demais para a API são reduzidas sozinhas; se nem assim couberem, o app avisa e não as envia); os outros arquivos ele abre pelo caminho. Clique numa imagem (no campo ou numa mensagem enviada) para vê-la em tamanho grande; Esc fecha.
- **Comandos**: digite `/` para ver os comandos do app e os do Claude Code (skills, `/compact`, `/review`…). Setas escolhem, Tab completa, Enter executa.
- **Mencionar arquivos**: digite `@` para listar os arquivos e pastas da pasta da conversa (respeita o `.gitignore` em repositórios git) e filtre digitando. Setas/Tab/Enter escolhem e Esc fecha; escolher uma pasta insere `@pasta/` e continua a lista dentro dela. O `@caminho` vai como texto para o Claude.
- **Cache do prompt**: o relógio ao lado do medidor de contexto conta quanto falta para o cache expirar (5 min ou 1 h, conforme o que a API gravou). Mandar a próxima mensagem antes disso reaproveita o contexto; depois, ele é lido de novo inteiro.
- **Remote Control**: o botão do celular no topo liga o `claude remote-control` na pasta atual e mostra o link para continuar pelo claude.ai/code ou pelo app do Claude. Precisa do login de assinatura do Claude e de uma pasta em que o Claude Code já confia; desligar (ou fechar o Claudie) encerra o servidor.
- **Esforço**: a barrinha ao lado do modelo define quanto o Claude pensa (padrão a máximo). Permissões e modelo abrem um menu que explica cada opção.
- **Ultracode**: o interruptor no cartão de esforço faz o Claude montar um fluxo com vários agentes para cada tarefa (o `ultracode` do Claude Code). Gasta bem mais do limite; precisa dos workflows ligados no Claude Code (no Pro, `enableWorkflows` no /config) e de um modelo com nível xhigh.
- **Conversas**: fixar no topo, arquivar, duplicar, exportar em Markdown, renomear e apagar (menu ⋯). Arquivar tira a conversa da lista (não vale para uma que está rodando); "Arquivadas", embaixo da lista, mostra as arquivadas (inclusive as que o app do Claude arquivou) e o menu ⋯ dela tem "Desarquivar". A busca (Ctrl+K) procura também dentro das mensagens.
- **Respostas**: copiar, ler em voz alta e **ramificar daqui** (nova conversa a partir daquela resposta; a original fica intacta). Hora em cada mensagem.
- **Git e worktrees**: o ramo atual da pasta aparece ao lado do título (também dentro de um worktree). "Nova conversa num worktree" (barra lateral) pede um nome curto, cria um ramo novo com `git worktree add` em `<pasta>/.claude/worktrees` (se o projeto já usa essa pasta) ou em `<pasta>-worktrees/` e abre uma conversa nele; ao apagar a última conversa de um worktree o app oferece removê-lo (com confirmação; mudanças não salvas impedem).
- **Pull request**: com o GitHub CLI (`gh`) instalado e a pasta num repositório do GitHub, o painel de detalhes mostra o PR do ramo (número, título, estado e resumo dos checks), com botões para abrir no navegador e para criar um (envia o ramo com `git push -u origin HEAD` e roda `gh pr create --fill`, só ao clicar e depois de confirmar).
- **Terminal**: o botão do topo (ou Ctrl+`) abre um terminal na pasta da conversa, sem pty: PowerShell (ou `pwsh`) no Windows, bash/zsh nos outros sistemas. Enter executa, ↑/↓ percorrem o histórico, Ctrl+C (ou o botão de parar) encerra o que está rodando e reinicia o shell, e "Mandar pro Claude" anexa a saída do último comando à mensagem. Cores ANSI são removidas; o shell fecha junto com a janela.
- **Enquanto o Claude trabalha**: dá para abrir outra conversa ou começar uma nova; a que está rodando continua em segundo plano (a lista mostra um círculo girando, ou um ponto âmbar quando ela espera a sua aprovação) e, ao voltar, a resposta e os cartões pendentes estão lá. O que você enviar entra na fila da conversa e sai quando ele terminar. O plano dele (TodoWrite ou as ferramentas Task*, com círculo tracejado, girando e marcado) fica fixo acima do campo e volta ao reabrir a conversa, e o medidor ao lado do botão mostra quanto do contexto já foi usado.
- **Avisos**: com a janela em segundo plano, uma notificação avisa quando o Claude termina ou precisa de aprovação. Ctrl+Shift+Espaço mostra o Claudinho de qualquer lugar. Ctrl+/ lista os atalhos.
- **Clawd**: o mascote do Claude Code está em todo lugar. Na abertura ele se monta com ladrilhos; na tela inicial ele segue o mouse com os olhos, acena quando você passa por cima, pula e solta faíscas no clique e dorme se você fica parado; ao lado do campo de mensagem ele acompanha o Claude (pensa, digita, chama você, pula quando termina); na barra lateral e no "pensando" ele balança e digita. Dá pra **pegar o Clawd** ao lado do campo: ele balança pendurado no mouse, cai quando você solta (e fica tonto se for arremessado) e volta andando pro lugar; clique nele e ele pula e fala (tem muitas falas). De vez em quando ele espia de trás da barra lateral quando você passa o mouse num projeto. Ele também é o ícone do app; o atalho **Claudinho** na pasta abre o app com esse ícone.
- **Várias janelas**: abra uma conversa em outra janela (menu ⋯ da conversa) ou uma janela nova com Ctrl+Shift+N; cada janela tem a sua conversa.
- **Conectores (MCP)**: o painel de detalhes (Ctrl+J) mostra cada conector com estado, escopo e número de ferramentas. Dá para desligar e ligar (vale também nas próximas mensagens da pasta), reconectar e remover (usa `claude mcp remove`), e "Adicionar conector" cria um novo (comando local, http ou sse, com variáveis ou cabeçalhos) via `claude mcp add`. Os erros do Claude Code aparecem no painel. Os conectores do claude.ai só são mostrados; gerencie-os em claude.ai/settings/connectors. Nada roda sem o seu clique.
- **Barra lateral**: grupos (pastas que abrem e fecham; arraste conversas para elas) e cores para as conversas, no menu ⋯.
- **Respostas longas** vêm dobradas, com um índice dos títulos e "Ler a resposta inteira".
- **Janelinhas flutuantes** (arraste pelo título, redimensione pelo canto e fixe no alfinete para ela ficar aberta no mesmo lugar, mesmo depois de fechar o app): **Alterações da conversa** (botão no topo: em pasta com git mostra o diff real contra o último commit, com lista de arquivos, totais, abrir arquivo e reverter com confirmação, atualizado ao fim de cada turno; a aba "Desta conversa" lista só o que o Claude mudou, com diff e "desfazer a partir daqui"), o **plano** do Claude destacado e o **player de música** (no botão de som).
- **Clique direito** no papel de parede abre um menu radial. `!comando` no campo pede ao Claude para rodar no terminal. Clique direito num bloquinho do trilho volta os arquivos para antes dali.
- **Enquanto o Claude trabalha**: o raciocínio aparece num bloco recolhível, cada ferramenta vira um bloquinho no trilho do topo (clique para ir até ela), edições aparecem como diff (+/−), e o papel de parede reage (ondas, ritmo).
- **Saídas das ferramentas**: o cartão mostra o começo do resultado e o botão "Ver tudo" carrega o texto completo; imagens devolvidas por uma ferramenta aparecem no cartão (clique para ampliar) e, ao reabrir a conversa, os cartões voltam com o resultado e o estado (ok ou erro). O que um subagente faz (Task/Agent) aparece como lista dentro do cartão dele, com o total de ferramentas, e o trabalho em segundo plano (comandos, agentes, monitores e fluxos do ultracode) fica numa faixa "Em segundo plano" acima do campo de mensagem enquanto roda.
- **Tarefas em segundo plano**: a faixa e o contador ao lado do campo ("2 tarefas") abrem uma janelinha como a "Tarefas em segundo plano" do Claude Desktop. Em "Rodando" cada tarefa tem um cartão com o tempo correndo, tokens e ferramentas; um fluxo mostra as fases (concluídos/total, um quadradinho por agente, e a tabela de agentes com tokens e duração ao abrir a fase) e cada tarefa tem o botão de parar (o fluxo pede um segundo clique). "Concluídas" guarda, por conversa e enquanto o app estiver aberto, as últimas 100 com situação (Concluída, Falhou, Parada), duração e resumo. As fases vêm do `meta` do script do fluxo e os agentes e tokens, do que o Claude Code grava em disco durante a execução (só leitura); a conversa aberta pode trocar à vontade que o estado continua no app. Esc fecha.
- **Desfazer**: passe o mouse numa mensagem sua e clique na seta: os arquivos que o Claude mudou a partir dali voltam ao que eram (com prévia antes).
- **Perguntas do Claude** viram um formulário com as opções; **textos colados grandes** viram um anexo que dá pra abrir e editar; **título automático** para conversas novas; aviso e "continuar sozinho" quando o limite do plano estoura.
- **Personalizar** (barra lateral ou `/personalizar`):
  - **Geral**: enviar com Enter ou Ctrl+Enter, **desempenho** (Automático, Máximo ou Leve), mostrar raciocínio, título automático, Clawd, papel de parede que reage, notificações e a **conta** (login do Claude Code ou chave de API).
  - **Fundo**: imagens, GIFs e vídeos seus como papel de parede (também arrastando para a aba Meus), e papéis de parede de vídeo e de página do **Wallpaper Engine** (os de cena só rodam dentro dele), com ajuste, escurecer, desfocar e som do vídeo.
  - **Cores**: paletas prontas, cor de destaque, do texto e do vidro, opacidade e desfoque do vidro, vidro claro ou escuro.
  - **Fontes**: fonte da interface e do código (da internet ou seus arquivos .ttf/.otf/.woff), tamanho do texto e largura da conversa.
  - **Sons**: um som seu para enviar, terminar, pedido de aprovação, erro, clique no papel de parede e abrir o app.
  - **Música**: suas músicas tocando em sequência ou aleatórias, no lugar da música dos temas ou junto (controles também no botão de som).
  - **Ícone e nome**: ícone da janela e da barra de tarefas, opcionalmente na barra lateral, e o nome do app.
  - Os arquivos ficam copiados em `%APPDATA%\Claudinho\pessoal`; "Restaurar tudo" volta ao padrão.
- **Uso do plano** (botão de fôlego no topo): o Clawd treina na academia; vai cansando conforme a sessão de 5 horas enche e dorme quando bate o limite, com a hora em que libera. Mostra também a semana e por modelo.
- **Clawd conversa**: de tempos em tempos ele comenta o projeto, conta curiosidades do Claude e da Anthropic, dá dicas do app e traz novidades (uma busca rápida por dia). Clique nele para ouvir a próxima. Dá pra desligar em Personalizar → Geral.
- **Créditos**: na barra lateral, quem fez cada arte e cada parte do app.
- **Som**: botão no topo (começa desligado).
- `/nova` começa uma conversa nova.

## Estrutura

- `src/main.js`: a janela e a ponte com o Claude Code (`query()` do `@anthropic-ai/claude-agent-sdk`), permissões e as ferramentas de tema que o Claude pode chamar.
- `src/preload.cjs`: as chamadas que a janela pode fazer.
- `src/renderer/`: a interface (`index.html`, `app.css`, `app.js`) e o motor dos papéis de parede (`wallpapers/`).
- `src/renderer/wallpapers/arte.mjs`: toca as peças da ASCII Magic e as animações importadas; `magia-indice.js` é gerado por `node tools/indice-magia.mjs`.
- `docs/pesquisa-melhorias.md`: o que os usuários mais pedem ao Claude e conceitos de design, com o que já foi feito e o que falta.
- `src/renderer/personalizar.js`: o painel Personalizar (cores, fontes, sons, música, ícone e nome).
- `src/renderer/extras.js`, `clawd-arte.js`, `clawd.js`, `interface.js`, `os.js`: raciocínio, diffs, desfazer, perguntas, limites, o Clawd, o trilho de atividade, as janelinhas e o menu radial.
- `src/renderer/simulador.js`: abre a interface num navegador comum com respostas de mentira, para mexer no visual sem o Claude Code.

## Testes

- `node tools/teste-sdk.mjs`: uma pergunta curta pelo SDK, para conferir o login e o streaming.
- `VIVO_LOG=1 VIVO_TESTE="mensagem" npm start`: envia a mensagem ao abrir e registra os eventos no terminal (`VIVO_ANEXO=arquivo` anexa um arquivo).
- `node`/testes: com `VIVO_PASTA` ou `VIVO_JS` o app usa um perfil separado (`%APPDATA%\Claudinho-teste`), então os testes não mexem nas suas configurações e rodam com o app aberto.
- `VIVO_MOTION=arquivo.json`: importa uma animação do ASCII Motion ao abrir. `VIVO_JS="expressão" VIVO_FOTO=tela.png`: roda um código na janela e salva uma foto dela.

## Licença e créditos

Código sob a licença MIT (veja `LICENSE`). As animações da biblioteca vêm do pacote [ascii-magic-art](https://www.ascii-magic.com/ascii) (MIT). O Claude Agent SDK é da Anthropic e segue os termos dela.

O Claudinho é um projeto independente de fã. Não é afiliado nem endossado pela Anthropic. Claude, Claude Code e Clawd são marcas da Anthropic.
