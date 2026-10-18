# 🐞 QA Board — Board Pessoal & para Times de Engenharia de Qualidade

O **QA Board** é um aplicativo desktop nativo (construído com **Tauri 2 + Rust** e **React 19 + TypeScript + Tailwind CSS v4**) projetado para analistas e engenheiros de QA organizarem **bugs**, **casos de teste**, **checklists reutilizáveis**, **execuções de teste (Test Runs)**, **sessões exploratórias** e **relatórios**, com integração opcional e segura ao **Jira**, **Azure DevOps** e **Slack**.

Todos os seus dados de QA permanecem **100% locais** em banco SQLite, sem telemetria e sem dependência de nuvem. As credenciais de integração (API Tokens, PATs e Webhooks) são armazenadas **exclusivamente no cofre nativo do sistema operacional** (Windows Credential Manager / macOS Keychain / Linux Secret Service) e jamais ficam expostas ao front-end.

---

## ✨ Funcionalidades Principais

### 1. 📋 Board Kanban de Bugs
- **Colunas editáveis**: crie novas colunas, renomeie ou remova colunas vazias. Já vem pré-configurado com o fluxo padrão de QA: *Novo*, *Em análise*, *Reportado*, *Aguardando fix*, *Reteste* e *Fechado*.
- **Drag & Drop fluido (`@dnd-kit`)**: arraste cards entre colunas ou reordene prioridades dentro da mesma coluna com persistência automática no SQLite.
- **Card completo de Bug**:
  - Título, Severidade (*Crítica, Alta, Média, Baixa*), Prioridade (*P1 a P4*), Ambiente, Versão/Build, Módulo/Feature e Tags;
  - Passos para Reproduzir, Resultado Esperado, Resultado Obtido e Link do Ticket Externo;
  - Confirmação de segurança antes de excluir qualquer card para evitar cliques acidentais;
  - **Rastreamento automático de regressões (`reopened_count`)**: sempre que um bug na coluna *Fechado* retorna para uma coluna ativa, o contador de reabertura é incrementado automaticamente.
- **Evidências com `Ctrl+V` e Drag & Drop**:
  - Cole prints diretamente da área de transferência com `Ctrl+V` dentro do modal do bug ou arraste imagens e vídeos;
  - Miniaturas integradas com visualização ampliada (zoom) e armazenamento em disco protegido contra *path traversal*.
- **Busca e Filtros Combinados**: filtre o board em tempo real por texto livre, tag, coluna/status, severidade, módulo ou versão/build.

### 2. 🧪 Biblioteca de Casos de Teste & Checklists Reutilizáveis
- **Catálogo de Casos de Teste**: cadastre título, módulo, tags, pré-condições, passos numerados, resultado esperado e prioridade.
- **Checklists / Templates Reutilizáveis**: templates prontos para **Smoke Test**, **Regressão** e **Pré-Release** (além de checklists personalizados) para iniciar baterias de teste em segundos.

### 3. ▶️ Execuções de Teste (Test Runs) & Sessões Exploratórias
- **Test Runs por Build e Ambiente**:
  - Crie uma execução selecionando casos avulsos ou carregando um Checklist inteiro;
  - Marque cada item como **Passou**, **Falhou**, **Bloqueado** ou **Pulado**, adicione observações e cole prints de evidência (`Ctrl+V`) diretamente no item;
  - **Gerar Bug a partir de Falha (1 clique)**: cria automaticamente um card de bug no Kanban já preenchido com os passos, build, ambiente, resultado esperado/obtido e copia todas as evidências anexadas no item que falhou.
- **Sessões de Teste Exploratório**:
  - Defina a missão (*Charter*), módulo, ambiente e versão/build;
  - **Cronômetro integrado** (*Iniciar / Pausar / Zerar*), bloco de anotações rápidas e registro direto de bugs encontrados durante a sessão.

### 4. 📊 Produtividade, Relatórios & Massa de Dados
- **Dashboard de Qualidade**:
  - Visão consolidada de bugs por status, severidade e módulo;
  - Taxa de aprovação (*Pass Rate*) por Test Run;
  - Lista de bugs reabertos (regressões) e tabela comparativa de qualidade entre builds.
- **Templates de Bug Report (1-Click Copy)**:
  - Gere o relatório de qualquer bug formatado automaticamente para **Markdown**, **Jira Wiki** ou **Azure DevOps** com botão **Copiar**.
- **Exportação de Relatório de Test Run (Markdown e PDF)**:
  - Exporte relatórios completos de execução em `.md` ou em **PDF 1.4 nativo** gerado localmente.
- **Atalho Global de Captura Rápida (`Ctrl+Shift+B`)**:
  - Pressione o atalho configurável para abrir o modal enxuto de captura rápida de bug (com suporte a `Ctrl+V` de print) de qualquer tela.
- **Gerador de Massa (CPF / CNPJ) & Biblioteca de Snippets**:
  - Gere **CPFs e CNPJs válidos** (cálculo oficial Módulo 11, com ou sem pontuação) localmente e organize snippets reutilizáveis (*Payloads JSON, Queries SQL, Massa de Dados e Scripts/cURL*).

### 5. 🔗 Integrações Seguras via Rust (Jira, Azure DevOps e Slack)
- **Jira (Cloud API v3 ADF & Server/Data Center API v2)**:
  - Crie issues diretamente a partir do card de bug (com descrição estruturada em *Atlassian Document Format* no Cloud ou Wiki no Server/DC), envie automaticamente os prints anexados ao card e vincule a chave (`QA-123`) e a URL ao card.
- **Azure DevOps (REST API 7.1 JSON Patch)**:
  - Crie Work Items do tipo *Bug* (`System.Title`, `Microsoft.VSTS.TCM.ReproSteps`, `SystemInfo`, `Severity`, `Tags`), faça upload binário dos prints anexados vinculando-os como `AttachedFile` e salve o ID e link no card.
- **Sincronização de Status com Revisão Obrigatória**:
  - Consulte o status externo individualmente no card ou em lote no topo do board;
  - Mapeamento configurável de `Status Externo → Coluna do Board` (ex.: `In Progress → Aguardando fix`, `Done → Fechado`);
  - **Modal de Revisão de Sincronização**: nenhuma coluna é alterada sem antes mostrar a você o que mudou (`Status Anterior → Novo` e `Coluna Atual → Coluna Proposta`) para sua confirmação.
- **Slack (Incoming Webhook)**:
  - Envie o resumo de qualquer Test Run (*aprovados, falhas, bloqueados, taxa de aprovação e lista dos casos que falharam*) para um canal do Slack, com modal de pré-visualização da mensagem antes do envio.

### 6. 💾 Backup Completo (`.zip`) e Modo Escuro/Claro
- **Exportar e Importar Backup (`.zip`)**: empacota todo o banco SQLite (`backup.json`) e a pasta `attachments/` em um único arquivo `.zip` com validação de integridade e esquema ao importar.
- **Tema Escuro e Claro**: alterne a qualquer momento no cabeçalho do aplicativo.

---

## 🔒 Arquitetura de Segurança

1. **Segredos no Cofre do Sistema Operacional (`keyring`)**:
   - Tokens do Jira, PATs do Azure DevOps e URLs de Webhook do Slack são gravados exclusivamente no cofre nativo do sistema operacional sob o serviço `com.qaboard.desktop`.
   - O front-end (React) **nunca** recebe o valor de nenhum segredo: ele apenas consulta se a credencial está configurada (`true/false`) e aciona comandos Rust.
2. **Chamadas HTTP 100% no Backend Rust (`reqwest` + `rustls-tls`)**:
   - Toda comunicação externa com Jira, Azure DevOps e Slack ocorre no processo Rust, com validação estrita de URLs HTTPS e mensagens de erro traduzidas para português sem vazar tokens ou URLs sensíveis em logs.
3. **Privilégio Mínimo (Tauri 2 Capabilities)**:
   - O arquivo [`src-tauri/capabilities/default.json`](file:///d:/BoardQA/src-tauri/capabilities/default.json) libera apenas as permissões locais estritamente necessárias (`sql`, `dialog`, `fs` na pasta de dados do app e `global-shortcut`).

---

## 🛠️ Pré-requisitos

Para compilar ou rodar o projeto em modo de desenvolvimento:

- **Node.js** `v18+` (recomendado `v20+` ou `v22+`) e **npm**
- **Rust** (`rustc` e `cargo` via [rustup.rs](https://rustup.rs/))
- **No Windows**:
  - *Microsoft Edge WebView2 Runtime* (já incluso por padrão no Windows 10/11)
  - *Microsoft C++ Build Tools* (Workload "Desenvolvimento para desktop com C++")

---

## 🚀 Como Rodar e Como Gerar o Executável

### 1. Instalar dependências

```bash
npm install
```

### 2. Rodar em modo de desenvolvimento

```bash
npm run tauri dev
```

*(O script [`scripts/run-tauri.mjs`](file:///d:/BoardQA/scripts/run-tauri.mjs) localiza automaticamente o `cargo` em `~/.cargo/bin`, funcionando tanto no PowerShell/CMD quanto no Git Bash/MINGW64).*

### 3. Gerar o Executável Portátil (`QA-Board.exe`) e Instaladores

```bash
npm run gerar-exe
```
*(ou `npm run tauri build`)*

Ao finalizar a compilação:
- **Executável direto (Portátil)**: é copiado automaticamente para a raiz do projeto em **`QA-Board.exe`**. Basta dar dois cliques nele a qualquer momento para abrir o aplicativo sem precisar de terminal aberto.
- **Instaladores do Windows**: ficam disponíveis em:
  - `src-tauri/target/release/bundle/nsis/QA Board_0.1.0_x64-setup.exe`
  - `src-tauri/target/release/bundle/msi/QA Board_0.1.0_x64_en-US.msi`
- **Como atualizar o executável após mudanças no código**: feche o `QA-Board.exe` e rode `npm run gerar-exe` novamente.

---

## 📖 Guia Rápido de Uso

1. **Criar e gerenciar Bugs**:
   - Na aba **Board de Bugs**, clique em **Novo Bug** (ou use o atalho global `Ctrl+Shift+B` em **Captura Rápida**).
   - Dentro do modal do bug, pressione **`Ctrl+V`** para colar qualquer print copiado na sua área de transferência.
   - Arraste os cards entre as colunas conforme o ciclo de vida do defeito.
2. **Planejar e Executar Testes**:
   - Na aba **Casos de Teste**, cadastre seus cenários e agrupe-os em **Checklists / Templates** (*Smoke*, *Regressão*, *Pré-Release*).
   - Na aba **Execuções (Test Runs)**, clique em **Nova Execução**, escolha um Checklist ou casos específicos, informe a *Build* e o *Ambiente* e marque cada item executado.
   - Se um caso falhar, clique em **Gerar Bug a partir de Falha** para criar o card no Kanban já preenchido e com as evidências copiadas.
3. **Configurar Jira, Azure DevOps e Slack**:
   - Acesse **Configurações & Integrações** no menu lateral.
   - Informe os dados não-sensíveis (URL base, projeto, organização) e clique em **Salvar Configurações**.
   - Cole o Token/PAT/Webhook no campo do cofre e clique em **Guardar no Cofre**. O campo será limpo imediatamente e o status mudará para **Configurado**.
   - Clique em **Testar conexão** para validar suas credenciais.
4. **Fazer Backup e Restaurar Dados**:
   - No topo do **Board de Bugs**, clique em **Exportar Backup (.zip)** para salvar todos os seus dados e anexos em um único arquivo `.zip`, ou em **Importar Backup (.zip)** para restaurar.

---

## 🧪 Testes Automatizados e Qualidade de Código

```bash
# Rodar testes automatizados do front-end (Vitest + Testing Library)
npm test

# Verificar lint (ESLint) e formatação (Prettier)
npm run lint
npm run format:check

# Rodar testes unitários e de integração com mocks HTTP no backend Rust
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 📂 Estrutura de Pastas

```text
├── docs/
│   └── DECISOES.md                 # Registro de decisões arquiteturais (ADR)
├── scripts/
│   └── run-tauri.mjs               # Wrapper multiplataforma para o CLI do Tauri + geração do QA-Board.exe
├── src/
│   ├── db/
│   │   ├── migrations.ts           # Migrations versionadas do SQLite (v1, v2, v3)
│   │   └── database.ts             # Repositório SQLite, backup e chamadas IPC para o Rust
│   ├── features/
│   │   ├── bugs/                   # Board Kanban, cards, filtros, preview de anexos e revisão de sync
│   │   ├── testcases/              # Biblioteca de Casos de Teste e Checklists reutilizáveis
│   │   ├── runs/                   # Execuções de Teste (Test Runs), sessões exploratórias e envio Slack
│   │   ├── reports/                # Dashboard QA, templates MD/Jira/ADO, exportação PDF/MD, snippets e CPF/CNPJ
│   │   └── settings/               # Configurações de Jira, Azure DevOps, Slack (OS Keyring) e mapeamento
│   ├── types/
│   │   └── models.ts               # Contratos e tipos TypeScript do domínio
│   ├── App.tsx                     # Shell principal, navegação e registro do atalho global
│   └── main.tsx                    # Ponto de entrada React
└── src-tauri/
    ├── capabilities/
    │   └── default.json            # Permissões de segurança restritas do Tauri 2
    ├── src/
    │   ├── integrations/
    │   │   └── mod.rs              # Cofre nativo (keyring) + clientes HTTP reqwest (Jira, ADO, Slack) + testes mockito
    │   ├── storage.rs              # Armazenamento seguro de anexos locais e empacotamento/validação ZIP
    │   ├── lib.rs                  # Registro de plugins e comandos Tauri
    │   └── main.rs                 # Binário desktop
    ├── Cargo.toml
    └── tauri.conf.json
```
