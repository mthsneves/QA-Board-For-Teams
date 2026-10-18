# Guia de Massas de Dados, Mocks e Testes do QA Board

Este documento descreve os pacotes de massa de dados (seed), o que cada arquivo contém e o roteiro de validação manual e automatizada sem depender de dados reais nem credenciais reais.

---

## Etapa A — Massas de Dados (Seed de Backup `.zip`)

O gerador [`scripts/gerar-massa.mjs`](file:///d:/BoardQA/scripts/gerar-massa.mjs) cria pacotes de backup compatíveis com o esquema SQLite (`v1` a `v3` em [`src/db/migrations.ts`](file:///d:/BoardQA/src/db/migrations.ts)) e com o botão **"Importar Backup (.zip)"** do topo do Board de Bugs.

Para regerar todos os pacotes a qualquer momento:

```bash
node scripts/gerar-massa.mjs
```

Os arquivos são gerados tanto na raiz do projeto (`d:\BoardQA\`) quanto na pasta [`test-data/`](file:///d:/BoardQA/test-data).

---

### 1. `massa-pequena.zip` (Funcionalidades completas + Casos de Borda)

Contém um ambiente completo e realista de QA para validar todas as abas do aplicativo:

| Entidade | Quantidade | Detalhes e Casos de Borda Incluídos |
| :--- | :---: | :--- |
| **Colunas do Kanban** | 6 | `Novo`, `Em análise`, `Reportado`, `Aguardando fix`, `Reteste`, `Fechado` (`is_done_column = true`). |
| **Cards de Bug** | 15 | Distribuídos nas 6 colunas, cobrindo as 4 severidades (`Crítica`, `Alta`, `Média`, `Baixa`) e prioridades `P1` a `P4`. |
| **Anexos PNG (Gerados por código)** | 11 | `bug-seed-01` possui **1 anexo** (`print_erro_pix.png`); `bug-seed-03` possui **10 anexos** coloridos (`evidencia_passo_01.png` a `10.png`); os demais possuem **0 anexos**. |
| **Casos de Borda de Texto** | — | `bug-seed-02` contém payloads `<script>alert(1)</script>` e `'; DROP TABLE bugs;--` além de aspas simples/duplas; `bug-seed-03` contém texto longo com **5.500+ caracteres** e quebras de linha; `bug-seed-01` e `bug-seed-04` incluem emojis (`🚨`, `🔥`, `📱`) e acentuação (`São Luís`, `Amapá`, `Conceição`). |
| **Bugs Reabertos (Regressões)** | 6 | Cards com `reopened_count > 0` (1x, 2x, 3x e 4x) distribuídos nas builds `v2.3.0`, `v2.4.0`, `v2.4.1` e `v2.5.0-rc1`. |
| **Vínculos Externos (Jira / ADO)** | 9 | Cards já vinculados a chaves do Jira (`QA-101` a `QA-106`) e IDs do Azure DevOps (`5001` a `5004`), apontando para `http://localhost:8787` com diversos `external_status` (`To Do`, `In Progress`, `Ready for QA`, `Done`, `New`, `Active`, `Resolved`, `Closed`). |
| **Casos de Teste** | 20 | `CT-01` a `CT-20` distribuídos em 8 módulos (`Checkout`, `Autenticação`, `Pagamentos PIX`, `Catálogo`, `Relatórios`, `Notificações`, `API Gateway`, `Mobile App`). |
| **Checklists Reutilizáveis** | 3 | `Checklist Smoke Test` (6 casos), `Suíte de Regressão Principal` (14 casos) e `Checklist Pré-Release` (8 casos). |
| **Execuções (Test Runs)** | 4 | 1) **100% Passou** (`v2.3.0`), 2) **100% Falhou** (`v2.4.0`), 3) **Misto** com *Passou, Falhou, Bloqueado e Pulado* (`v2.4.1`), 4) **Em Execução** com itens *Pendentes* (`v2.5.0-rc1`). |
| **Sessões Exploratórias** | 3 | Com *charter*, ambiente, build, notas de sessão, durações no timer (`2745s`, `1820s`, `950s`) e bugs vinculados. |
| **Snippets & Massa** | 5 | Exemplos nas 4 categorias (`Payload JSON`, `Query SQL`, `Massa de Dados`, `Script / cURL`) usando apenas tokens fictícios (`FAKE-TOKEN-NAO-USAR`). |

**O que validar com `massa-pequena.zip`:**
1. No **Board de Bugs**, clique em **Importar Backup (.zip)** e selecione `massa-pequena.zip`.
2. Verifique que os **15 bugs** aparecem distribuídos nas **6 colunas**, sem executar o `<script>alert(1)</script>` (proteção contra XSS) e sem quebrar o SQLite com `'; DROP TABLE bugs;--`.
3. Abra o card `bug-seed-01` (1 anexo) e o `bug-seed-03` (10 anexos + texto de 5.500+ caracteres) e clique no botão de lupa nas miniaturas para abrir o preview ampliado.
4. Na aba **Casos de Teste**, valide os 20 casos e os 3 checklists.
5. Na aba **Execuções (Test Runs)**, alterne entre as 4 runs (100% Passou, 100% Falhou, Misto e Pré-Release) e confira as3 sessões exploratórias com seus respectivos tempos e bugs gerados.
6. Na aba **Produtividade & Relatórios**, confira os gráficos do Dashboard, a tabela de **Bugs Reabertos**, o **Comparativo entre Builds** (`v2.3.0` a `v2.5.0-rc1`), os templates de Bug Report (Markdown / Jira / Azure DevOps), a exportação PDF/MD e os 5 snippets.

---

### 2. `massa-grande.zip` (Teste de Desempenho e Volume)

Projetado para testar a fluidez da interface, renderização do Kanban, busca textual e filtros combinados sob alto volume:

- **1.000 Cards de Bug** (`BUG-0001` a `BUG-1000`) distribuídos nas 6 colunas (~166 por coluna), 10 módulos e 6 versões de build (`v2.1.0` a `v2.5.0-rc1`).
- **500 Casos de Teste** (`CT-0001` a `CT-0500`) e **3 Checklists** (Smoke com 50 casos, Regressão com 250 casos, Pré-Release com 100 casos).
- **30 Execuções de Teste (Test Runs)** totalizando **450 itens de execução** avaliados.

**O que validar com `massa-grande.zip`:**
1. Importe `massa-grande.zip` pelo botão **Importar Backup (.zip)**.
2. No **Board de Bugs**, teste a barra de busca em tempo real (ex.: digite `BUG-0999` ou `Faturamento`), filtre por severidade `Crítica`, módulo `Logística` e build `v2.4.1`, e verifique o contador `Exibindo X de 1000`.
3. Arraste um card entre colunas e verifique que a reordenação permanece responsiva.
4. Abra a aba **Produtividade & Relatórios** e verifique que a agregação dos 1.000 bugs e 30 runs no Dashboard é instantânea.

---

### 3. `massa-malformada.zip` e `test-data/malformados/*.zip` (Testes Negativos e Segurança)

Além do arquivo `massa-malformada.zip` na raiz, a pasta [`test-data/malformados/`](file:///d:/BoardQA/test-data/malformados) contém **6 pacotes `.zip` individuais** para testar cada condição de erro na importação de backup:

| Arquivo | Cenário de Falha / Ataque | Comportamento Esperado ao Importar |
| :--- | :--- | :--- |
| `massa-malformada.zip` | Pacote principal malformado (`version: 999`, `columns: []` e entrada `../../fora.txt`). | Recusa a importação com mensagem de erro amigável em português sem alterar os dados atuais. |
| `01-zip-corrompido.zip` | Bytes truncados que não formam um cabeçalho ZIP válido. | Recusa com erro: *"Arquivo ZIP inválido ou corrompido"*. |
| `02-json-invalido.zip` | Arquivo ZIP válido, mas `backup.json` com sintaxe JSON truncada. | Recusa com erro: *"O arquivo de backup não contém um JSON válido"*. |
| `03-campo-obrigatorio-faltando.zip` | `backup.json` com bug sem os campos obrigatórios `title` e `column_id`. | Recusa com erro: *"Um ou mais bugs do backup não possuem 'id', 'title' ou 'column_id'"*. |
| `04-zip-slip-path-traversal.zip` | Contém entrada maliciosa `../../fora.txt` tentando escapar do diretório de dados (*Zip Slip*). | Recusa ou bloqueia a extração fora de `attachments/` sem jamais criar `fora.txt` fora da pasta do app. |
| `05-anexo-inexistente.zip` | `backup.json` referencia `attachments/att-fantasma-999_nao_existe.png`, mas o binário não está no ZIP. | **Observação de QA**: atualmente `validate_backup_json` / `import_backup_zip_to_dir` valida o JSON mas não verifica se todos os caminhos listados em `attachments[]` existem fisicamente dentro do ZIP (será coberto por teste na Etapa C conforme Regra 2). |
| `06-versao-desconhecida.zip` | `backup.json` com `"version": 999`. | Recusa com erro: *"Versão de backup não suportada: 999"*. |
