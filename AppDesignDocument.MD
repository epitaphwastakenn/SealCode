# Harp — App Design Document

## Objetivo

Reconstruir o Harp sobre a base do T3Code como um aplicativo desktop/web para desenvolvimento assistido por múltiplos agentes de IA. O produto deve manter o usuário em uma thread única do Harp, mesmo quando a sessão nativa do provider muda.

Este documento descreve o produto-alvo, os contratos funcionais e as prioridades de reconstrução. A versão Android foi removida do escopo.

## Escopo

Incluído:

- aplicativo desktop Windows;
- interface web/desktop compartilhada;
- backend local e remoto;
- threads, projetos e sessões nativas;
- providers Codex, Antigravity, Claude, Cursor, Grok, OpenCode e CommandCode;
- ferramentas, terminal, arquivos, diffs, revisão e runtime streaming;
- transferência automática de contexto entre providers;
- descoberta dinâmica de modelos;
- visualizador de imagens;
- watchdog e reconexão;
- controle remoto pelo navegador/desktop autorizado via rede privada;
- instalador Windows.

Fora do escopo:

- aplicativo Android;
- APK e AAB;
- package ou deep links Android;
- paridade de recursos exclusivos de dispositivos móveis.

## Identidade

Toda a identidade pública deve usar Harp:

- nome do produto: `Harp`;
- variante atual: `Harp (Alpha)`;
- executável e instalador com nome Harp;
- ícone Harp no aplicativo, instalador, atalhos, notificações e telas de erro;
- nenhuma menção visível a T3Code ou T3 Code.

Referências técnicas legadas só podem permanecer quando forem necessárias para compatibilidade, e devem ser documentadas.

## Arquitetura principal

Separar os conceitos abaixo:

- `Harp thread`: conversa visual persistente do produto;
- `provider`: Codex, Antigravity, Claude, Cursor, Grok, OpenCode ou CommandCode;
- `native session`: sessão real mantida pelo provider;
- `model`: modelo atualmente usado na sessão;
- `resume cursor`: identificador usado para recuperar uma sessão;
- `runtime event`: evento normalizado emitido por ferramenta, terminal, arquivo, diff, erro ou resposta.

Uma thread pode conter várias sessões nativas:

```text
Harp thread
├── Codex native session
├── Antigravity native session
└── OpenCode native session
```

O Harp não deve criar uma thread de orquestração separada para cada provider.

## Providers e harnesses

Criar um contrato comum para todos os adapters:

- detectar instalação e disponibilidade;
- autenticar sem expor credenciais;
- listar modelos e capacidades;
- selecionar reasoning level;
- criar, recuperar e encerrar sessão;
- enviar turns e receber streaming;
- ingerir transcript e eventos de runtime;
- expor ferramentas, comandos, arquivos alterados e diffs;
- persistir e reutilizar resume cursors;
- reportar falhas de forma estruturada;
- suportar watchdog e reconexão quando aplicável.

### Codex

Suportar sessões persistentes, ferramentas, terminal, arquivos, diffs, reasoning levels, geração de títulos e visualização de imagens. Modelos Codex também são usados como visualizadores de imagem.

### Antigravity

Implementar sessões nativas, recuperação de sessão, transcript estruturado, eventos de ferramentas, arquivos modificados, comandos, resultados, watchdog e reconexão.

### Cursor

Integrar o harness/CLI do Cursor sem confundi-lo com executáveis chamados `agent` de outros providers. Preservar sessões, eventos, ferramentas, arquivos, watchdog, transcript e resume cursor.

### OpenCode

Suportar modelos customizados, API keys próprias, billing da API key, endpoints configuráveis, descoberta de modelos, recuperação de sessão e reconexão avançada.

Corrigir erros causados por caminhos de projeto inválidos no ambiente do system prompt. Uma pasta sem Git é um estado normal: recursos dependentes de Git ficam indisponíveis, mas o chat e o restante do ambiente continuam funcionando.

### Claude, Grok e CommandCode

Adicionar adapters usando o contrato comum, preservando provider, modelo, autenticação, sessão, streaming, transcript, erros e ferramentas disponíveis. CommandCode deve ser um provider real, não um alias de outro provider.

## Transferência de contexto entre providers

### Objetivo

O usuário permanece na mesma thread do Harp, enquanto cada provider mantém sua própria sessão nativa. Ao trocar de provider e enviar uma mensagem, o contexto mais recente deve ser transferido antes do novo prompt ser processado.

### Exemplo

```text
Codex thread A
  ↓ troca de provider
Antigravity session A recebe o contexto do Codex
  ↓ troca de provider
Codex session A recebe o contexto mais recente do Antigravity
```

### ContextTransferCoordinator

Criar um `ContextTransferCoordinator` no servidor para controlar source → target.

Fluxo obrigatório:

1. O usuário troca o provider no picker.
2. O picker libera a troca; nenhuma transferência é iniciada ainda.
3. O usuário envia um prompt.
4. O servidor identifica se a troca exige outra sessão nativa.
5. O prompt original fica pendente e não é enviado ao destino ainda.
6. O provider anterior recebe uma instrução interna de handoff.
7. O provider anterior gera um resumo estruturado sem editar arquivos e sem executar ferramentas.
8. O destino inicia ou recupera sua sessão nativa dentro da mesma thread do Harp.
9. O destino recebe o resumo e o prompt original no mesmo `sendTurn`.
10. A resposta do destino aparece normalmente no histórico visual.

Formato do turno enviado ao destino:

```text
<context-transfer>
Resumo estruturado da sessão anterior.
</context-transfer>

<user-request>
Prompt original do usuário.
</user-request>
```

### Conteúdo do resumo

O handoff deve conter, de forma compacta e estruturada:

- objetivo atual;
- decisões tomadas;
- arquivos relevantes;
- alterações realizadas;
- comandos executados;
- ferramentas usadas;
- resultados importantes;
- erros e limitações;
- tarefas pendentes;
- próxima ação recomendada;
- estado atual do projeto;
- provider e modelo de origem.

### Regras de sessão

Transferir somente quando houver troca de sessão nativa:

- provider diferente;
- instância diferente;
- modelo que exige reinício da sessão.

Não transferir quando o provider conseguir trocar o modelo dentro da sessão atual.

Ao retornar para um provider anterior, reutilizar a sessão nativa anterior e injetar o handoff mais recente.

### Invisibilidade e finalidade interna

O handoff não pode aparecer como mensagem normal, resposta do assistente ou checkpoint visual. Propagar uma finalidade interna de turno:

- `user`;
- `context-transfer`.

O runtime, os adapters e o armazenamento devem respeitar essa finalidade.

### Estados persistidos

Persistir o handoff associado a:

- mensagem original;
- thread do Harp;
- provider de origem;
- modelo de origem;
- provider destino;
- modelo destino;
- resumo gerado;
- estado;
- erro;
- timestamps.

Estados:

- `pending`;
- `running`;
- `completed`;
- `failed`.

Se o resumo já foi gerado e o envio ao destino falhar, reutilizá-lo. Nunca gerar um segundo resumo automaticamente para o mesmo retry.

### Falhas

Se a geração do resumo falhar:

- não enviar o prompt ao destino;
- preservar o prompt original;
- mostrar erro transitório;
- permitir `Retry transfer`;
- permitir `Send without context`.

`Retry transfer` não pode duplicar mensagens nem criar dois handoffs. `Send without context` envia apenas o prompt original no destino.

Mostrar temporariamente:

```text
Transferring context from Codex to Antigravity
Your prompt will be sent after the new session receives the latest context.
```

Remover esse estado assim que o destino aceitar o turn, começar a responder, falhar ou for cancelado. Ele nunca deve ficar preso depois que o modelo já respondeu.

## SealMemory.MD

Remover o uso operacional automático de `SealMemory.MD`:

- não ler;
- não criar;
- não injetar;
- não usar como fonte de handoff;
- não usar `sealMemoryDelivery` em bindings de sessão.

Arquivos existentes devem permanecer intactos e sem uso automático.

## Descoberta dinâmica de modelos

Descobrir modelos a partir de:

- capacidades do provider;
- configurações locais;
- API keys;
- endpoint configurado;
- CLI instalada;
- modelos customizados do OpenCode;
- modelos Codex disponíveis.

Cada modelo deve informar:

- provider;
- id;
- nome de exibição;
- visão;
- ferramentas;
- reasoning;
- níveis disponíveis;
- limite de contexto;
- disponibilidade;
- origem da descoberta.

O picker deve atualizar sem apagar seleções válidas.

## Visualizador de imagens

Adicionar um picker separado para o modelo responsável por interpretar imagens. Apenas modelos Codex podem aparecer nele.

Configurações:

- modelo visualizador;
- reasoning level do visualizador;
- modelo principal separado do visualizador;
- persistência da escolha.

Fluxo:

1. O usuário envia uma imagem na mensagem principal.
2. Se o modelo principal tiver visão, ele recebe a imagem normalmente.
3. Se não tiver visão ou falhar ao interpretá-la, chamar o visualizador Codex.
4. O visualizador produz uma descrição estruturada.
5. A descrição é passada ao modelo principal junto do prompt.
6. A mensagem continua sendo uma única interação visual do usuário.

Se nenhum visualizador estiver selecionado, manter o erro original e incluir:

```text
Selecione um modelo visualizador para dar capacidades de visão à este modelo.
```

## Watchdog e reconexão

O watchdog deve detectar processos encerrados, streams interrompidos, ausência de eventos, heartbeat perdido e sessões vivas sem resposta.

Estados:

- conectando;
- ativo;
- sem resposta;
- reconectando;
- recuperado;
- falhou.

OpenCode deve ter reconexão avançada com backoff, retomada de sessão, resume cursor, recuperação de stream, prevenção de duplicação e preservação de prompt pendente.

Cursor e Antigravity devem ter watchdog integrado ao ciclo de vida da sessão.

## Threads, projetos e sidebar

Suportar:

- projetos;
- threads;
- busca;
- arquivamento;
- pin de projeto;
- pin de thread;
- settle/unsettle;
- pastas;
- agrupamento;
- collapse;
- estados ativos, snoozed e settled;
- provider e status.

Projetos pinned devem aparecer em seção própria acima dos threads:

```text
Pinned
  projeto pinned

Threads
  thread
```

Remover o relógio que aparece no hover da sidebar. Ao fazer unsettle, remover a checkmark imediatamente e cancelar qualquer animação que a mantenha visível.

## Composer

Usar um composer compacto:

```text
[ área do prompt ]

[ + ] [ Usage ] [ modo ]                    [ modelo ] [ microfone ] [ enviar ]
```

Usage e modo ficam à esquerda. Modelo, microfone e Send ficam à direita. O botão `+` fornece anexos e ações adicionais.

Corrigir o liquid glass do composer:

- remover placeholder duplicado;
- corrigir blur e blend layers;
- impedir glows vazando sob os controles;
- preservar contraste;
- impedir sobreposição com checkout/status bar;
- manter controles nítidos.

Remover a outline adicional em hover e foco. A chatbox não deve ganhar borda magenta ou outline exagerado quando o usuário passa o mouse ou digita.

## Aparência

Na aba Appearance:

- fonte da UI;
- fonte do código;
- UI scaling;
- tamanho customizado da UI;
- tamanho customizado do código;
- volume.

Defaults desktop:

```text
UI: Segoe UI
Código: Consolas
UI size: 14
Código size: 13
```

A escala deve afetar textos, menus, sidebar, composer, headers e botões sem overflow.

O fill do slider de volume deve acompanhar exatamente o valor atual, inclusive durante o drag.

## Projetos sem Git

Uma pasta sem Git deve ser considerada normal. Não mostrar stack trace nem tratar a ausência de VCS como falha fatal.

Mostrar estado neutro, como `No Git repository`, e desabilitar somente recursos que dependem de Git. Chat, arquivos, terminal e providers devem continuar disponíveis.

## Controle remoto

O desktop deve poder hospedar o backend localmente e ser controlado por outro dispositivo autorizado através de uma rede privada, especialmente Tailscale.

O backend deve:

- iniciar localmente;
- aceitar clientes autorizados;
- transmitir threads e eventos em tempo real;
- suportar múltiplos workers quando necessário;
- manter sessões nativas;
- suportar pairing por link ou QR code;
- reconectar após queda de rede.

O fluxo deve ser claro: iniciar backend, criar autorização, parear o cliente e abrir as threads existentes. Tailscale HTTPS deve persistir a configuração e mostrar erro explícito se endpoint ou porta forem inválidos.

## Segurança

- nunca exibir API keys no histórico;
- nunca gravar tokens em logs;
- proteger endpoints remotos;
- exigir authorized clients;
- separar credenciais de configurações exportáveis;
- não incluir dados pessoais no instalador;
- não incluir `SealMemory.MD` automaticamente.

## Build desktop

Gerar:

- build de desenvolvimento;
- executável desktop;
- instalador NSIS Windows x64;
- artefato portable quando possível.

O instalador deve conter o app compilado, assets, runtime necessário e branding Harp. A versão deve ser verificável no executável e no instalador.

## Testes de aceitação

Validar contratos, runtime, providers, coordinator, `ProviderCommandReactor`, ingestão de runtime e `ChatView`.

Testes mínimos:

- criar thread;
- criar projeto;
- pin/unpin;
- settle/unsettle;
- enviar prompt;
- streaming;
- ferramentas;
- terminal;
- arquivos e diffs;
- troca Codex → Antigravity;
- troca Antigravity → Codex;
- sequência A → B → A → B;
- troca de modelo dentro da mesma sessão sem handoff;
- falha no modelo de origem;
- retry sem duplicação;
- envio sem contexto;
- handoff invisível;
- nenhum uso de `SealMemory.MD`;
- descoberta dinâmica;
- visualizador de imagem;
- modelo sem visão;
- OpenCode customizado com API key;
- OpenCode reconectando;
- Cursor/Antigravity watchdog;
- pasta sem Git;
- fontes, escala e volume;
- composer e liquid glass;
- backend local;
- pairing e authorized clients;
- reconexão do cliente remoto.

## Ordem de reconstrução

1. Restaurar a base do T3Code.
2. Restaurar monorepo, dependências e scripts.
3. Restaurar contratos comuns de providers.
4. Implementar o ciclo Codex.
5. Implementar Antigravity, Cursor e OpenCode.
6. Implementar Claude, Grok e CommandCode.
7. Implementar transcripts e runtime ingestion.
8. Implementar watchdog e reconexão.
9. Implementar descoberta dinâmica.
10. Implementar `ContextTransferCoordinator`.
11. Implementar visualizador de imagens.
12. Restaurar threads, projetos e sidebar.
13. Restaurar composer e liquid glass.
14. Restaurar Appearance.
15. Restaurar backend remoto, pairing e Tailscale.
16. Gerar e validar instalador desktop.

O fluxo principal que deve funcionar no final é:

```text
abrir projeto
→ criar thread
→ escolher provider e modelo
→ enviar prompt
→ usar ferramentas
→ trocar provider
→ transferir contexto
→ continuar na mesma thread
→ controlar remotamente pelo desktop/browser autorizado
```

## Critério de conclusão

O Harp está reconstruído quando o usuário consegue trabalhar em uma única thread, alternar entre providers sem perder contexto, usar modelos customizados, interpretar imagens via visualizador Codex, recuperar sessões após falhas, trabalhar em pastas sem Git, personalizar a interface e controlar a instância desktop remotamente.
