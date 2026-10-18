import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Wifi,
} from 'lucide-react';
import {
  BoardColumn,
  DEFAULT_STATUS_MAPPINGS,
  IntegrationSecretKey,
  IntegrationSecretStatus,
  IntegrationSettings,
  JiraDeploymentType,
} from '../../types/models';
import {
  deleteIntegrationSecret,
  getIntegrationSettings,
  getIntegrationsSecretStatus,
  listColumns,
  saveIntegrationSecret,
  saveIntegrationSettings,
  testAdoConnection,
  testJiraConnection,
  testSlackConnection,
} from '../../db/database';

interface SettingsViewProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onNotify }) => {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [secretStatus, setSecretStatus] = useState<IntegrationSecretStatus>({
    jira_configured: false,
    azure_devops_configured: false,
    slack_configured: false,
  });
  const [columns, setColumns] = useState<BoardColumn[]>([]);

  // Secret input states — strictly write-only, cleared immediately after saving to OS keyring
  const [jiraSecretInput, setJiraSecretInput] = useState('');
  const [editingJiraSecret, setEditingJiraSecret] = useState(false);

  const [adoSecretInput, setAdoSecretInput] = useState('');
  const [editingAdoSecret, setEditingAdoSecret] = useState(false);

  const [slackSecretInput, setSlackSecretInput] = useState('');
  const [editingSlackSecret, setEditingSlackSecret] = useState(false);

  // Loading & feedback states per service
  const [testingService, setTestingService] = useState<'jira' | 'ado' | 'slack' | null>(null);
  const [serviceFeedback, setServiceFeedback] = useState<{
    jira?: { ok: boolean; text: string };
    ado?: { ok: boolean; text: string };
    slack?: { ok: boolean; text: string };
  }>({});

  // Status mapping new rule inputs
  const [newExternalStatus, setNewExternalStatus] = useState('');
  const [newTargetColumn, setNewTargetColumn] = useState('Fechado');

  const loadData = useCallback(async () => {
    try {
      const [cfg, sec, cols] = await Promise.all([
        getIntegrationSettings(),
        getIntegrationsSecretStatus(),
        listColumns(),
      ]);
      setSettings(cfg);
      setSecretStatus(sec);
      setColumns(cols);
      if (cols.length > 0) {
        setNewTargetColumn(cols[cols.length - 1].name);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar configurações.', 'error');
    }
  }, [onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!settings) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Carregando configurações de integrações...
      </div>
    );
  }

  const handleSaveGeneralSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      await saveIntegrationSettings(settings);
      const reloaded = await getIntegrationSettings();
      setSettings(reloaded);
      onNotify('Configurações de integração salvas com sucesso!');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao salvar configurações.', 'error');
    }
  };

  const handleSaveSecret = async (key: IntegrationSecretKey, rawValue: string) => {
    try {
      const updatedStatus = await saveIntegrationSecret(key, rawValue);
      setSecretStatus(updatedStatus);
      if (key === 'jira_api_secret') {
        setJiraSecretInput('');
        setEditingJiraSecret(false);
        onNotify('Token do Jira armazenado com segurança no cofre do sistema!');
      } else if (key === 'azure_devops_pat') {
        setAdoSecretInput('');
        setEditingAdoSecret(false);
        onNotify('PAT do Azure DevOps armazenado com segurança no cofre do sistema!');
      } else {
        setSlackSecretInput('');
        setEditingSlackSecret(false);
        onNotify('Webhook do Slack armazenado com segurança no cofre do sistema!');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao salvar segredo no cofre.', 'error');
    }
  };

  const handleDeleteSecret = async (key: IntegrationSecretKey, label: string) => {
    try {
      const updatedStatus = await deleteIntegrationSecret(key);
      setSecretStatus(updatedStatus);
      onNotify(`Segredo de ${label} removido do cofre do sistema.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao remover segredo.', 'error');
    }
  };

  const handleTestJira = async () => {
    setTestingService('jira');
    setServiceFeedback((prev) => ({ ...prev, jira: undefined }));
    try {
      await saveIntegrationSettings(settings);
      const msg = await testJiraConnection(settings);
      setServiceFeedback((prev) => ({ ...prev, jira: { ok: true, text: msg } }));
      onNotify(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setServiceFeedback((prev) => ({ ...prev, jira: { ok: false, text: msg } }));
      onNotify(msg, 'error');
    } finally {
      setTestingService(null);
    }
  };

  const handleTestAdo = async () => {
    setTestingService('ado');
    setServiceFeedback((prev) => ({ ...prev, ado: undefined }));
    try {
      await saveIntegrationSettings(settings);
      const msg = await testAdoConnection(settings);
      setServiceFeedback((prev) => ({ ...prev, ado: { ok: true, text: msg } }));
      onNotify(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setServiceFeedback((prev) => ({ ...prev, ado: { ok: false, text: msg } }));
      onNotify(msg, 'error');
    } finally {
      setTestingService(null);
    }
  };

  const handleTestSlack = async () => {
    setTestingService('slack');
    setServiceFeedback((prev) => ({ ...prev, slack: undefined }));
    try {
      const msg = await testSlackConnection();
      setServiceFeedback((prev) => ({ ...prev, slack: { ok: true, text: msg } }));
      onNotify(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setServiceFeedback((prev) => ({ ...prev, slack: { ok: false, text: msg } }));
      onNotify(msg, 'error');
    } finally {
      setTestingService(null);
    }
  };

  const handleAddMappingRule = () => {
    const ext = newExternalStatus.trim();
    if (!ext) {
      onNotify('Informe o nome do status externo (ex.: Done, In Progress).', 'error');
      return;
    }
    const filtered = settings.status_mappings.filter(
      (m) => m.external_status.toLowerCase() !== ext.toLowerCase(),
    );
    setSettings({
      ...settings,
      status_mappings: [...filtered, { external_status: ext, target_column_name: newTargetColumn }],
    });
    setNewExternalStatus('');
  };

  const handleRemoveMappingRule = (externalStatus: string) => {
    setSettings({
      ...settings,
      status_mappings: settings.status_mappings.filter((m) => m.external_status !== externalStatus),
    });
  };

  const handleRestoreDefaultMappings = () => {
    setSettings({
      ...settings,
      status_mappings: DEFAULT_STATUS_MAPPINGS.map((m) => ({ ...m })),
    });
    onNotify('Mapeamento de status padrão restaurado. Clique em Salvar Configurações para gravar.');
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header & Security Guarantee Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            Integrações & Cofre de Credenciais
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Tokens, PATs e Webhooks são gravados exclusivamente no cofre nativo do sistema
            operacional (OS Keyring) via Rust e nunca retornam ao front-end.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSaveGeneralSettings()}
          data-testid="save-integration-settings-btn"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer shrink-0"
        >
          <Save className="w-4 h-4" />
          Salvar Configurações
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* JIRA CARD */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-blue-500" />
                Jira (Cloud v3 & Data Center/Server v2)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Criação de issues com descrição formatada, upload de anexos e leitura de status.
              </p>
            </div>
            <span
              data-testid="jira-secret-status-badge"
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                secretStatus.jira_configured
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {secretStatus.jira_configured ? 'Configurado' : 'Não configurado'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tipo de Jira
              </label>
              <select
                aria-label="Tipo de Jira"
                value={settings.jira.deployment_type}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    jira: {
                      ...settings.jira,
                      deployment_type: e.target.value as JiraDeploymentType,
                    },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="cloud">Jira Cloud (REST API v3 + ADF)</option>
                <option value="server">Jira Data Center / Server (REST API v2)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                URL Base do Jira
              </label>
              <input
                type="url"
                aria-label="URL Base do Jira"
                placeholder="https://empresa.atlassian.net"
                value={settings.jira.base_url}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    jira: { ...settings.jira, base_url: e.target.value },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            {settings.jira.deployment_type === 'cloud' && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  E-mail da Conta Atlassian (Jira Cloud)
                </label>
                <input
                  type="email"
                  aria-label="E-mail da Conta Atlassian"
                  placeholder="qa@empresa.com"
                  value={settings.jira.email}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      jira: { ...settings.jira, email: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Chave do Projeto (Project Key)
              </label>
              <input
                type="text"
                aria-label="Chave do Projeto Jira"
                placeholder="QA"
                value={settings.jira.project_key}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    jira: { ...settings.jira, project_key: e.target.value },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tipo de Issue Padrão
              </label>
              <input
                type="text"
                aria-label="Tipo de Issue Padrão Jira"
                placeholder="Bug"
                value={settings.jira.issue_type}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    jira: { ...settings.jira, issue_type: e.target.value },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Jira Secret Vault Box */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                {settings.jira.deployment_type === 'cloud'
                  ? 'API Token do Jira Cloud (Cofre do SO)'
                  : 'Personal Access Token / Senha (Cofre do SO)'}
              </span>
              {secretStatus.jira_configured && !editingJiraSecret && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingJiraSecret(true)}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Substituir
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSecret('jira_api_secret', 'Jira')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remover
                  </button>
                </div>
              )}
            </div>

            {!secretStatus.jira_configured || editingJiraSecret ? (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  aria-label="Segredo do Jira"
                  placeholder="Cole o token aqui (nunca será exibido novamente)..."
                  value={jiraSecretInput}
                  onChange={(e) => setJiraSecretInput(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  data-testid="save-jira-secret-btn"
                  onClick={() => void handleSaveSecret('jira_api_secret', jiraSecretInput)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
                >
                  Guardar no Cofre
                </button>
                {editingJiraSecret && (
                  <button
                    type="button"
                    onClick={() => {
                      setJiraSecretInput('');
                      setEditingJiraSecret(false);
                    }}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Credencial protegida no cofre do sistema operacional.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              data-testid="test-jira-connection-btn"
              disabled={testingService === 'jira'}
              onClick={() => void handleTestJira()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition cursor-pointer disabled:opacity-50"
            >
              {testingService === 'jira' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5 text-indigo-500" />
              )}
              Testar conexão
            </button>
            {serviceFeedback.jira && (
              <span
                className={`text-xs font-medium ${
                  serviceFeedback.jira.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {serviceFeedback.jira.text}
              </span>
            )}
          </div>
        </section>

        {/* AZURE DEVOPS CARD */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-sky-500" />
                Azure DevOps (REST API 7.1 JSON Patch)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Criação de Work Items (Bug), upload e vínculo de anexos e sincronização de status.
              </p>
            </div>
            <span
              data-testid="ado-secret-status-badge"
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                secretStatus.azure_devops_configured
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {secretStatus.azure_devops_configured ? 'Configurado' : 'Não configurado'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Organização
              </label>
              <input
                type="text"
                aria-label="Organização Azure DevOps"
                placeholder="minha-org"
                value={settings.azure_devops.organization}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    azure_devops: { ...settings.azure_devops, organization: e.target.value },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Projeto
              </label>
              <input
                type="text"
                aria-label="Projeto Azure DevOps"
                placeholder="ProdutoPrincipal"
                value={settings.azure_devops.project}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    azure_devops: { ...settings.azure_devops, project: e.target.value },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tipo de Work Item
              </label>
              <input
                type="text"
                aria-label="Tipo de Work Item Azure DevOps"
                placeholder="Bug"
                value={settings.azure_devops.work_item_type}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    azure_devops: { ...settings.azure_devops, work_item_type: e.target.value },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* ADO Secret Vault Box */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                Personal Access Token — PAT (Cofre do SO)
              </span>
              {secretStatus.azure_devops_configured && !editingAdoSecret && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingAdoSecret(true)}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Substituir
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSecret('azure_devops_pat', 'Azure DevOps')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remover
                  </button>
                </div>
              )}
            </div>

            {!secretStatus.azure_devops_configured || editingAdoSecret ? (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  aria-label="PAT do Azure DevOps"
                  placeholder="Cole o PAT aqui (escopo Work Items Read & Write)..."
                  value={adoSecretInput}
                  onChange={(e) => setAdoSecretInput(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  data-testid="save-ado-secret-btn"
                  onClick={() => void handleSaveSecret('azure_devops_pat', adoSecretInput)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
                >
                  Guardar no Cofre
                </button>
                {editingAdoSecret && (
                  <button
                    type="button"
                    onClick={() => {
                      setAdoSecretInput('');
                      setEditingAdoSecret(false);
                    }}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                PAT protegido no cofre do sistema operacional.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              data-testid="test-ado-connection-btn"
              disabled={testingService === 'ado'}
              onClick={() => void handleTestAdo()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition cursor-pointer disabled:opacity-50"
            >
              {testingService === 'ado' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5 text-indigo-500" />
              )}
              Testar conexão
            </button>
            {serviceFeedback.ado && (
              <span
                className={`text-xs font-medium ${
                  serviceFeedback.ado.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {serviceFeedback.ado.text}
              </span>
            )}
          </div>
        </section>

        {/* SLACK WEBHOOK CARD */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-emerald-500" />
                Slack (Incoming Webhook)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Envio de resumos de Test Runs com estatísticas e lista de casos que falharam.
              </p>
            </div>
            <span
              data-testid="slack-secret-status-badge"
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                secretStatus.slack_configured
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {secretStatus.slack_configured ? 'Configurado' : 'Não configurado'}
            </span>
          </div>

          <div className="rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                URL de Incoming Webhook do Slack (Cofre do SO)
              </span>
              {secretStatus.slack_configured && !editingSlackSecret && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingSlackSecret(true)}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Substituir
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSecret('slack_webhook_url', 'Slack')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remover
                  </button>
                </div>
              )}
            </div>

            {!secretStatus.slack_configured || editingSlackSecret ? (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  aria-label="Webhook URL do Slack"
                  placeholder="https://hooks.slack.com/services/T000.../B000.../XXXX..."
                  value={slackSecretInput}
                  onChange={(e) => setSlackSecretInput(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  data-testid="save-slack-secret-btn"
                  onClick={() => void handleSaveSecret('slack_webhook_url', slackSecretInput)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
                >
                  Guardar no Cofre
                </button>
                {editingSlackSecret && (
                  <button
                    type="button"
                    onClick={() => {
                      setSlackSecretInput('');
                      setEditingSlackSecret(false);
                    }}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Webhook URL protegido no cofre do sistema operacional.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              data-testid="test-slack-connection-btn"
              disabled={testingService === 'slack'}
              onClick={() => void handleTestSlack()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition cursor-pointer disabled:opacity-50"
            >
              {testingService === 'slack' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5 text-indigo-500" />
              )}
              Testar conexão
            </button>
            {serviceFeedback.slack && (
              <span
                className={`text-xs font-medium ${
                  serviceFeedback.slack.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {serviceFeedback.slack.text}
              </span>
            )}
          </div>
        </section>

        {/* STATUS MAPPING CARD */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Mapeamento de Status Externo → Coluna do Board
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Define para qual coluna do Kanban o card será proposto ao sincronizar com Jira ou
                Azure DevOps.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRestoreDefaultMappings}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              title="Restaurar mapeamento padrão"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Padrão
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label="Novo status externo"
              placeholder="Status externo (ex.: Done, Em Homologação)"
              value={newExternalStatus}
              onChange={(e) => setNewExternalStatus(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
            <span className="text-xs text-slate-400">→</span>
            <select
              aria-label="Coluna destino do mapeamento"
              value={newTargetColumn}
              onChange={(e) => setNewTargetColumn(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            >
              {columns.map((col) => (
                <option key={col.id} value={col.name}>
                  {col.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="add-status-mapping-btn"
              onClick={handleAddMappingRule}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
            {settings.status_mappings.map((rule) => (
              <div
                key={rule.external_status}
                className="flex items-center justify-between px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                    {rule.external_status}
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    {rule.target_column_name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveMappingRule(rule.external_status)}
                  className="text-slate-400 hover:text-rose-500 cursor-pointer"
                  title="Remover regra"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
