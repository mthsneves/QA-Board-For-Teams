# Registro de Decisões de Arquitetura e Produto (ADR)

Este documento registra as decisões tomadas ao longo do desenvolvimento do **QA Board**, priorizando simplicidade, segurança e facilidade de manutenção.

## Fase 0 — Ambiente e Esqueleto

1. **Tailwind CSS v4 via `@tailwindcss/vite`**:
   - Escolhido por dispensar arquivos extras (`postcss.config.js`), mantendo a configuração enxuta no `vite.config.ts` e `src/index.css`.
2. **ESLint 9 (Flat Config) + Prettier + Vitest**:
   - Configurados desde a Fase 0 com scripts dedicados (`npm run lint`, `npm run format:check`, `npm test`) para garantir qualidade contínua antes de cada entrega de fase.
3. **Permissões Tauri 2 (Capabilities)**:
   - Adotado o modelo de privilégio mínimo em `src-tauri/capabilities/default.json`, liberando apenas acesso local ao banco SQLite (`sql:*`), diálogos nativos (`dialog:default`) e arquivos locais do app (`fs:default`).
4. **TLS em Puro Rust (`rustls-tls`) no `reqwest`**:
   - Evita dependências de OpenSSL externas no Windows/macOS/Linux e garante compilação reprodutível para as chamadas HTTP de integração que ocorrerão exclusivamente no backend Rust.
5. **Cofre Nativo do Sistema (`keyring` v3)**:
   - Configurado com as features `windows-native`, `apple-native` e `sync-secret-service` sob o identificador `com.qaboard.desktop`, garantindo que tokens de Jira, Azure DevOps e webhooks do Slack jamais saiam do Rust para o front-end.
