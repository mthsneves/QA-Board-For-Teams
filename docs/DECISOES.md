# Registro de Decisões de Arquitetura e Produto (ADR)

Este documento registra as decisões tomadas ao longo do desenvolvimento do **QA Board**, priorizando simplicidade, segurança e facilidade de manutenção.

## Fase 0 — Ambiente e Esqueleto

1. **Tailwind CSS v4 via `@tailwindcss/vite`**:
   - Escolhido por dispensar arquivos extras (`postcss.config.js`), mantendo a configuração enxuta no `vite.config.ts` e `src/index.css`.
2. **ESLint 9 (Flat Config) + Prettier + Vitest**:
   - Configurados desde a Fase 0 com scripts dedicados (`npm run lint`, `npm run format:check`, `npm test`) para garantir qualidade contínua antes de cada entrega de fase.
3. **Permissões Tauri 2 (Capabilities)**:
   - Adotado o modelo de privilégio mínimo em `src-tauri/capabilities/default.json`, liberando apenas acesso local ao banco SQLite (`sql:*`), diálogos nativos (`dialog:default`, `dialog:allow-open`, `dialog:allow-save`), atalho global (`global-shortcut:*`) e arquivos locais do app (`fs:default`).
4. **TLS em Puro Rust (`rustls-tls`) no `reqwest`**:
   - Evita dependências de OpenSSL externas no Windows/macOS/Linux e garante compilação reprodutível para as chamadas HTTP de integração que ocorrerão exclusivamente no backend Rust.
5. **Cofre Nativo do Sistema (`keyring` v3)**:
   - Configurado com as features `windows-native`, `apple-native` e `sync-secret-service` sob o identificador `com.qaboard.desktop`, garantindo que tokens de Jira, Azure DevOps e webhooks do Slack jamais saiam do Rust para o front-end.

## Fase 1 — Núcleo (MVP)

1. **Migrations Versionadas em SQLite (`src/db/migrations.ts`)**:
   - Criada a tabela `schema_migrations` controlada na abertura da conexão SQLite (`sqlite:qaboard.db`), permitindo evoluir o banco nas próximas fases sem perda de dados.
2. **Armazenamento de Anexos na Pasta de Dados do App (`src-tauri/src/storage.rs`)**:
   - Prints colados via `Ctrl+V` e vídeos arrastados são gravados na subpasta `attachments/` dentro de `app_data_dir` via comandos Rust com sanitização de nomes e proteção contra *path traversal*, referenciando apenas o `relative_path` no SQLite.
3. **Formato de Backup Único (`.zip`)**:
   - O pacote `.zip` exportado pelo Rust contém o `backup.json` (com versão de schema, preferências, colunas, bugs e metadados de anexos) na raiz e todos os arquivos binários dentro de `attachments/`. Na importação, o JSON e os caminhos são validados antes de qualquer extração.
4. **Rastreamento Automático de Reabertura de Bugs (`reopened_count`)**:
   - Quando um bug sai da coluna final (`Fechado`) de volta para qualquer coluna ativa (ex.: `Reteste`), o contador `reopened_count` é incrementado automaticamente para alimentar os indicadores de regressão do Dashboard na Fase 3.

## Fase 2 — Casos de Teste e Execuções

1. **Snapshot dos Casos nos Itens de Execução (`test_run_items`)**:
   - Ao iniciar um `Test Run`, cada item copia o título, módulo, prioridade, pré-condições, passos e resultado esperado do caso de teste naquele instante. Isso preserva o histórico fiel da execução mesmo que o caso de teste seja editado ou excluído futuramente na biblioteca.
2. **Templates/Checklists Padrão Pré-carregados (`Smoke`, `Regressão`, `Pré-Release`)**:
   - O banco inicializa automaticamente os três templates clássicos de QA e permite associar casos tanto pela tela do caso de teste quanto pela tela do checklist.
3. **Geração de Bug com Cópia de Evidências**:
   - Quando o analista clica em **"Gerar Bug a partir de Falha"** em um item de execução, o sistema cria o card na primeira coluna do Kanban já preenchido com `build_version`, `environment`, `steps_to_reproduce`, `expected_result` e `actual_result` (observação da falha), copia os anexos daquele item para o card do bug e grava a referência cruzada (`created_bug_id` e `test_run_item_id`).

## Fase 3 — Produtividade e Relatórios

1. **Gerador Nativo de PDF 1.4 (`generateTestRunPdfBytes`)**:
   - Para evitar dependências pesadas de navegador ou serviços externos, implementamos um gerador de documento PDF 1.4 autônomo com suporte a codificação WinAnsi (acentuação em português) e gravação direta em disco pelo comando Rust `save_export_file`.
2. **Atalho Global Configurável (`tauri-plugin-global-shortcut`)**:
   - O atalho padrão `CommandOrControl+Shift+B` (personalizável pelo analista) registra um atalho global no sistema operacional que restaura/foca a janela do QA Board e abre imediatamente o modal de Captura Rápida com suporte a `Ctrl+V` de prints.
3. **Geração Local de Massa de Dados (CPF e CNPJ Módulo 11)**:
   - Os geradores de CPF e CNPJ calculam localmente os dígitos verificadores oficiais (Módulo 11), garantindo 100% de validade em formulários com validação algorítmica sem depender de internet.

## Fase 4 — Integrações Seguras via Rust (Jira, Azure DevOps e Slack)

1. **Segredos Isolados no Cofre do Sistema Operacional (`keyring`)**:
   - Os segredos (`jira_api_secret`, `azure_devops_pat`, `slack_webhook_url`) são gravados e lidos exclusivamente pelo código Rust no serviço `com.qaboard.desktop` do cofre nativo do sistema (Windows Credential Manager / macOS Keychain / Secret Service). O front-end React jamais recebe o valor do token: apenas consulta flags booleanas (`jira_configured`, `azure_devops_configured`, `slack_configured`) e limpa o campo de senha imediatamente após enviar ao comando Tauri.
2. **Suporte Híbrido a Jira Cloud (API v3 + ADF) e Jira Data Center/Server (API v2)**:
   - No modo **Jira Cloud**, a autenticação usa `Basic base64(email:api_token)` contra `/rest/api/3/issue` com descrição estruturada em **Atlassian Document Format (ADF)**. No modo **Data Center/Server**, usa `Bearer <PAT>` (ou `Basic` caso e-mail/usuário seja informado) contra `/rest/api/2/issue` com descrição em texto/wiki. O upload de prints do card é feito via `multipart/form-data` em `/rest/api/{2|3}/issue/{key}/attachments` com o cabeçalho obrigatório `X-Atlassian-Token: nocheck`.
3. **Criação de Work Item e Anexos no Azure DevOps (REST API 7.1 JSON Patch)**:
   - A criação de bugs no Azure DevOps utiliza `PATCH` com `Content-Type: application/json-patch+json` preenchendo `System.Title`, `Microsoft.VSTS.TCM.ReproSteps`, `Microsoft.VSTS.TCM.SystemInfo`, `Microsoft.VSTS.Common.Severity` e `System.Tags`. Os prints do card são enviados primeiro como stream binário para `/_apis/wit/attachments?api-version=7.1` e vinculados como relações `AttachedFile` no documento JSON Patch.
4. **Sincronização de Status com Revisão Obrigatória (`StatusSyncModal`)**:
   - Tanto o botão individual **"Atualizar Status"** no card quanto o botão em lote no topo do board consultam os status externos e abrem um modal de revisão comparando `Status Externo Anterior → Novo` e `Coluna Atual → Coluna Proposta` antes de aplicar qualquer mudança no SQLite, garantindo que nenhuma alteração do analista seja sobrescrita sem confirmação explícita.
5. **Tratamento de Erros HTTP sem Vazamento de Segredos**:
   - O módulo `src-tauri/src/integrations/mod.rs` intercepta falhas de rede, timeouts e códigos HTTP (`401`, `403`, `404`, `429`, `5xx`), traduzindo-os para mensagens amigáveis em português e omitindo URLs de webhook ou cabeçalhos sensíveis de qualquer mensagem de erro.

