# QA Board

**QA Board** é um aplicativo desktop pessoal para analistas e engenheiros de QA organizarem **bugs (Kanban)**, **casos de teste**, **execuções de teste (test runs)** e **sessões exploratórias**, com armazenamento **100% local** (SQLite + anexos locais) e integração segura opcional com **Jira**, **Azure DevOps** e **Slack** via cofre de credenciais do sistema operacional.

---

## Pré-requisitos

- **Node.js** (v20+ ou v24+) e **npm**
- **Rust** (`rustc` e `cargo` via `rustup`)
- **No Windows**:
  - Microsoft Edge WebView2 Runtime
  - Microsoft C++ Build Tools (com carga de trabalho C++ e Windows 10/11 SDK)

---

## Como rodar em desenvolvimento

1. Instale as dependências do front-end:
   ```powershell
   npm install
   ```
2. Inicie o aplicativo desktop em modo de desenvolvimento (abre a janela nativa do Tauri com hot-reload):
   ```powershell
   npm run tauri dev
   ```

> **Dica (Windows):** Caso você tenha acabado de instalar o Rust e o terminal atual ainda não reconheça o comando `cargo`, feche e reabra o terminal ou execute:
> ```powershell
> $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
> ```

---

## Como rodar testes e verificações de código

- **Testes do front-end (Vitest)**:
  ```powershell
  npm test
  ```
- **Lint e formatação (ESLint + Prettier)**:
  ```powershell
  npm run lint
  npm run format:check
  ```
- **Testes do backend Rust**:
  ```powershell
  cd src-tauri
  cargo test
  ```

---

## Como gerar o instalador de produção

Para compilar o aplicativo otimizado e gerar o instalador nativo para o seu sistema operacional (`.msi` / `.exe` no Windows):

```powershell
npm run tauri build
```

Os instaladores gerados ficarão disponíveis em:
- `src-tauri/target/release/bundle/msi/`
- `src-tauri/target/release/bundle/nsis/`

---

## Estrutura de Pastas

```text
BoardQA/
├── docs/
│   └── DECISOES.md              # Decisões arquiteturais e técnicas
├── src/
│   ├── features/
│   │   ├── bugs/                # Board Kanban, cards de bug, filtros e anexos
│   │   ├── testcases/           # Biblioteca de casos de teste e checklists
│   │   ├── runs/                # Execuções de teste e sessões exploratórias
│   │   ├── reports/             # Dashboard, templates, exportação PDF/MD e massa de dados
│   │   └── settings/            # Configurações e integrações seguras
│   ├── test/                    # Configuração de testes (Vitest + Testing Library)
│   ├── App.tsx                  # Shell principal da aplicação
│   └── main.tsx                 # Ponto de entrada React
└── src-tauri/
    ├── capabilities/
    │   └── default.json         # Permissões mínimas do Tauri 2
    ├── src/
    │   ├── integrations/        # Integrações HTTP (Jira, Azure DevOps, Slack) e Keyring
    │   ├── lib.rs               # Inicialização de plugins e comandos Tauri
    │   └── main.rs              # Ponto de entrada binário Rust
    ├── Cargo.toml               # Dependências Rust
    └── tauri.conf.json          # Configuração do Tauri 2
```

---

## Segurança e Privacidade

- **100% Local**: Todos os dados de QA ficam armazenados localmente no seu computador. Não há telemetria ou envio automático de dados.
- **Zero Segredos no Front-end**: Tokens de API (Jira, Azure DevOps) e URLs de Webhook (Slack) são gravados exclusivamente no **Cofre do Sistema Operacional** (Windows Credential Manager / macOS Keychain / Linux Secret Service) usando a crate `keyring` no Rust. O React nunca recebe os tokens.
