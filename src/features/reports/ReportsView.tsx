import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  FileText,
  FileDown,
  Code2,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Trash2,
  RotateCcw,
  Layers,
  GitCompare,
} from 'lucide-react';
import {
  BoardColumn,
  BugCard,
  BugReportFormat,
  SEVERITY_OPTIONS,
  SNIPPET_CATEGORIES,
  SnippetCategory,
  SnippetItem,
  TestRun,
  TestRunItem,
  ThemeMode,
} from '../../types/models';
import {
  createSnippet,
  deleteSnippet,
  exportTestRunReportDialog,
  listAllTestRunItems,
  listBugs,
  listColumns,
  listSnippets,
  listTestRuns,
} from '../../db/database';
import {
  formatBugReport,
  formatTestRunMarkdownReport,
  generateQaEmail,
  generateUuidV4,
  generateValidCnpj,
  generateValidCpf,
} from './productivityUtils';

interface ReportsViewProps {
  theme: ThemeMode;
}

export function ReportsView({ theme }: ReportsViewProps) {
  const isLight = theme === 'light';
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'templates' | 'run_reports' | 'snippets'
  >('dashboard');

  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [bugs, setBugs] = useState<BugCard[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [allRunItems, setAllRunItems] = useState<TestRunItem[]>([]);
  const [snippets, setSnippets] = useState<SnippetItem[]>([]);

  // Bug Report Templates state
  const [selectedBugId, setSelectedBugId] = useState<string>('');
  const [reportFormat, setReportFormat] = useState<BugReportFormat>('markdown');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Test Run Report Export state
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);

  // Snippets & Test Data Generator state
  const [cpfFormatted, setCpfFormatted] = useState(() => generateValidCpf(true));
  const [cpfRaw, setCpfRaw] = useState(() => generateValidCpf(false));
  const [cnpjFormatted, setCnpjFormatted] = useState(() => generateValidCnpj(true));
  const [cnpjRaw, setCnpjRaw] = useState(() => generateValidCnpj(false));
  const [qaEmail, setQaEmail] = useState(() => generateQaEmail());
  const [uuidVal, setUuidVal] = useState(() => generateUuidV4());

  const [snipTitle, setSnipTitle] = useState('');
  const [snipCategory, setSnipCategory] = useState<SnippetCategory>('Payload JSON');
  const [snipContent, setSnipContent] = useState('');

  const reloadData = useCallback(async () => {
    const [colsData, bugsData, runsData, runItemsData, snippetsData] = await Promise.all([
      listColumns(),
      listBugs(),
      listTestRuns(),
      listAllTestRunItems(),
      listSnippets(),
    ]);
    setColumns(colsData);
    setBugs(bugsData);
    setRuns(runsData);
    setAllRunItems(runItemsData);
    setSnippets(snippetsData);

    if (!selectedBugId && bugsData.length > 0) {
      setSelectedBugId(bugsData[0].id);
    }
    if (!selectedRunId && runsData.length > 0) {
      setSelectedRunId(runsData[0].id);
    }
  }, [selectedBugId, selectedRunId]);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  const copyToClipboard = async (text: string, key: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Fallback for test environments
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2500);
  };

  // Selected Bug for Templates
  const selectedBug: BugCard = bugs.find((b) => b.id === selectedBugId) ||
    bugs[0] || {
      id: 'sample-bug',
      column_id: 'col-new',
      position: 0,
      title: 'Exemplo: Falha ao finalizar pedido com cupom expirado',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: 'Homologação',
      build_version: 'v2.4.0',
      module: 'Checkout',
      tags: ['cupom', 'pagamento'],
      steps_to_reproduce:
        '1. Adicionar item ao carrinho\n2. Inserir cupom EXPIRADO10\n3. Clicar em Aplicar',
      expected_result: 'Exibir alerta informando que o cupom expirou.',
      actual_result: 'Aplicação retorna erro 500 e trava o resumo do pedido.',
      external_ticket_url: '',
      external_ticket_key: '',
      external_provider: '',
      external_status: '',
      reopened_count: 0,
      test_run_item_id: null,
      exploratory_session_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

  const generatedBugReportText = formatBugReport(selectedBug, reportFormat);

  // Selected Run for Export
  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0] || null;
  const selectedRunItems = selectedRun
    ? allRunItems.filter((i) => i.run_id === selectedRun.id)
    : [];
  const previewRunMarkdown = selectedRun
    ? formatTestRunMarkdownReport(selectedRun, selectedRunItems)
    : '';

  const handleExportRunReport = async (format: 'md' | 'pdf') => {
    if (!selectedRun) return;
    const result = await exportTestRunReportDialog(selectedRun, selectedRunItems, format);
    if (result) {
      setExportStatusMsg(
        format === 'pdf'
          ? 'Relatório PDF gerado e exportado com sucesso!'
          : 'Relatório Markdown exportado com sucesso!',
      );
      setTimeout(() => setExportStatusMsg(null), 4000);
    }
  };

  const handleCreateSnippet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!snipTitle.trim() || !snipContent.trim()) return;
    await createSnippet({
      title: snipTitle,
      category: snipCategory,
      content: snipContent,
    });
    setSnipTitle('');
    setSnipContent('');
    await reloadData();
  };

  // Dashboard Aggregations
  const reopenedBugs = bugs.filter((b) => b.reopened_count > 0);

  const moduleCounts: Record<string, number> = {};
  for (const b of bugs) {
    const mod = b.module.trim() || 'Sem módulo';
    moduleCounts[mod] = (moduleCounts[mod] || 0) + 1;
  }
  const sortedModules = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]);

  // Build Comparison Aggregation
  const buildSet = new Set<string>();
  bugs.forEach((b) => {
    if (b.build_version.trim()) buildSet.add(b.build_version.trim());
  });
  runs.forEach((r) => {
    if (r.build_version.trim()) buildSet.add(r.build_version.trim());
  });
  const buildsList = Array.from(buildSet);

  const cardClass = `rounded-2xl border p-5 ${
    isLight ? 'bg-white border-slate-200' : 'bg-slate-900/70 border-slate-800'
  }`;

  const inputClass = `rounded-lg border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
    isLight
      ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
      : 'bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-500'
  }`;

  return (
    <div className="space-y-5">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Produtividade, Dashboard & Relatórios
          </h2>
          <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Indicadores de qualidade, gerador de Bug Reports (MD / Jira / Azure DevOps), exportação
            de Test Runs em PDF/MD e massa de dados local.
          </p>
        </div>

        <div
          className={`inline-flex flex-wrap rounded-xl p-1 border ${
            isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'dashboard'
                ? 'bg-indigo-600 text-white'
                : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('templates')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'templates'
                ? 'bg-indigo-600 text-white'
                : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Templates de Bug Report</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('run_reports')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'run_reports'
                ? 'bg-indigo-600 text-white'
                : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileDown className="h-3.5 w-3.5" />
            <span>Exportar Test Run (MD / PDF)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('snippets')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'snippets'
                ? 'bg-indigo-600 text-white'
                : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Massa de Dados & Snippets</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          TAB 1: DASHBOARD
      ===================================================================== */}
      {activeTab === 'dashboard' && (
        <div className="space-y-5">
          {/* Top KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={cardClass}>
              <span className="text-xs text-slate-400">Total de Bugs</span>
              <div className="text-2xl font-bold mt-1">{bugs.length}</div>
            </div>
            <div className={cardClass}>
              <span className="text-xs text-rose-400">Bugs Críticos / Altos</span>
              <div className="text-2xl font-bold text-rose-400 mt-1">
                {bugs.filter((b) => b.severity === 'Crítica' || b.severity === 'Alta').length}
              </div>
            </div>
            <div className={cardClass}>
              <span className="text-xs text-amber-400">Bugs Reabertos (Regressões)</span>
              <div className="text-2xl font-bold text-amber-400 mt-1">{reopenedBugs.length}</div>
            </div>
            <div className={cardClass}>
              <span className="text-xs text-indigo-400">Execuções de Teste (Runs)</span>
              <div className="text-2xl font-bold text-indigo-400 mt-1">{runs.length}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Bugs by Status */}
            <div className={cardClass}>
              <h3 className="font-bold text-sm mb-3">Bugs por Status (Coluna)</h3>
              <div className="space-y-2.5">
                {columns.map((col) => {
                  const count = bugs.filter((b) => b.column_id === col.id).length;
                  const pct = bugs.length > 0 ? Math.round((count / bugs.length) * 100) : 0;
                  return (
                    <div key={col.id} className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span>{col.name}</span>
                        <span className="font-semibold">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bugs by Severity */}
            <div className={cardClass}>
              <h3 className="font-bold text-sm mb-3">Bugs por Severidade</h3>
              <div className="space-y-2.5">
                {SEVERITY_OPTIONS.map((sev) => {
                  const count = bugs.filter((b) => b.severity === sev).length;
                  const pct = bugs.length > 0 ? Math.round((count / bugs.length) * 100) : 0;
                  const barColor =
                    sev === 'Crítica'
                      ? 'bg-rose-500'
                      : sev === 'Alta'
                        ? 'bg-orange-500'
                        : sev === 'Média'
                          ? 'bg-amber-500'
                          : 'bg-sky-500';
                  return (
                    <div key={sev} className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span>{sev}</span>
                        <span className="font-semibold">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bugs by Module */}
            <div className={cardClass}>
              <h3 className="font-bold text-sm mb-3 flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-indigo-400" />
                <span>Bugs por Módulo</span>
              </h3>
              {sortedModules.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhum bug registrado.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {sortedModules.map(([modName, count]) => (
                    <div
                      key={modName}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950/40 border border-slate-800/70"
                    >
                      <span className="font-medium truncate">{modName}</span>
                      <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Pass / Fail Rate per Test Run & Reopened Bugs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={cardClass}>
              <h3 className="font-bold text-sm mb-3">Taxa de Passou / Falhou por Test Run</h3>
              {runs.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma execução registrada.</p>
              ) : (
                <div className="space-y-3">
                  {runs.map((run) => {
                    const items = allRunItems.filter((i) => i.run_id === run.id);
                    const total = items.length;
                    const passed = items.filter((i) => i.status === 'Passou').length;
                    const failed = items.filter((i) => i.status === 'Falhou').length;
                    const passPct = total > 0 ? Math.round((passed / total) * 100) : 0;
                    const failPct = total > 0 ? Math.round((failed / total) * 100) : 0;
                    return (
                      <div key={run.id} className="space-y-1.5 text-xs">
                        <div className="flex justify-between font-medium">
                          <span>
                            {run.name}{' '}
                            {run.build_version && (
                              <span className="text-indigo-400 font-mono">
                                ({run.build_version})
                              </span>
                            )}
                          </span>
                          <span>
                            <span className="text-emerald-400">{passed} Passou</span> •{' '}
                            <span className="text-rose-400">{failed} Falhou</span> ({passPct}%)
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden flex">
                          <div className="bg-emerald-500 h-full" style={{ width: `${passPct}%` }} />
                          <div className="bg-rose-500 h-full" style={{ width: `${failPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Reopened Bugs (Regressions) */}
            <div className={cardClass}>
              <h3 className="font-bold text-sm mb-3 flex items-center gap-1.5">
                <RotateCcw className="h-4 w-4 text-amber-400" />
                <span>Bugs Reabertos / Regressões ({reopenedBugs.length})</span>
              </h3>
              {reopenedBugs.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Nenhum bug foi reaberto após fechado até o momento.
                </p>
              ) : (
                <div className="space-y-2 text-xs">
                  {reopenedBugs.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10"
                    >
                      <span className="font-semibold truncate">{b.title}</span>
                      <span className="text-amber-300 font-bold shrink-0">
                        Reaberto {b.reopened_count}x
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Simple Build Comparison Table */}
          <div className={cardClass}>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-1.5">
              <GitCompare className="h-4 w-4 text-indigo-400" />
              <span>Comparação entre Builds</span>
            </h3>
            {buildsList.length === 0 ? (
              <p className="text-xs text-slate-500">
                Informe o campo &ldquo;Versão / Build&rdquo; nos Bugs ou nas Execuções para comparar
                builds.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 pr-4">Build / Versão</th>
                      <th className="py-2 px-4">Total de Bugs</th>
                      <th className="py-2 px-4">Bugs Críticos / Altos</th>
                      <th className="py-2 px-4">Bugs Reabertos</th>
                      <th className="py-2 pl-4">Taxa de Aprovação (Runs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {buildsList.map((build) => {
                      const bBugs = bugs.filter((b) => b.build_version.trim() === build);
                      const critHigh = bBugs.filter(
                        (b) => b.severity === 'Crítica' || b.severity === 'Alta',
                      ).length;
                      const reop = bBugs.filter((b) => b.reopened_count > 0).length;
                      const bRuns = runs.filter((r) => r.build_version.trim() === build);
                      const bRunIds = new Set(bRuns.map((r) => r.id));
                      const bItems = allRunItems.filter((i) => bRunIds.has(i.run_id));
                      const bPassed = bItems.filter((i) => i.status === 'Passou').length;
                      const passRate =
                        bItems.length > 0
                          ? `${Math.round((bPassed / bItems.length) * 100)}%`
                          : 'N/A';

                      return (
                        <tr key={build}>
                          <td className="py-2.5 pr-4 font-mono font-bold text-indigo-400">
                            {build}
                          </td>
                          <td className="py-2.5 px-4 font-semibold">{bBugs.length}</td>
                          <td className="py-2.5 px-4 text-rose-400 font-semibold">{critHigh}</td>
                          <td className="py-2.5 px-4 text-amber-400 font-semibold">{reop}</td>
                          <td className="py-2.5 pl-4 text-emerald-400 font-semibold">{passRate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: BUG REPORT TEMPLATES (MARKDOWN, JIRA, AZURE DEVOPS)
      ===================================================================== */}
      {activeTab === 'templates' && (
        <div className={`${cardClass} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="select-bug-template" className="text-xs font-semibold">
                Selecionar Bug:
              </label>
              <select
                id="select-bug-template"
                value={selectedBugId}
                onChange={(e) => setSelectedBugId(e.target.value)}
                className={inputClass}
              >
                {bugs.length === 0 ? (
                  <option value="">Exemplo padrão (nenhum bug cadastrado)</option>
                ) : (
                  bugs.map((b) => (
                    <option key={b.id} value={b.id}>
                      [{b.severity}] {b.title}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Format Selector Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setReportFormat('markdown')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  reportFormat === 'markdown'
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                Formato Markdown
              </button>
              <button
                type="button"
                onClick={() => setReportFormat('jira')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  reportFormat === 'jira'
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                Formato Jira
              </button>
              <button
                type="button"
                onClick={() => setReportFormat('azure_devops')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  reportFormat === 'azure_devops'
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                Formato Azure DevOps
              </button>
            </div>
          </div>

          <div className="relative">
            <pre
              data-testid="bug-report-output"
              className={`rounded-xl border p-4 text-xs font-mono whitespace-pre-wrap overflow-x-auto ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-800'
                  : 'bg-slate-950 border-slate-800 text-slate-200'
              }`}
            >
              {generatedBugReportText}
            </pre>

            <button
              type="button"
              onClick={() => void copyToClipboard(generatedBugReportText, 'bug-report')}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
            >
              {copiedKey === 'bug-report' ? (
                <>
                  <Check className="h-4 w-4" />
                  <span>Copiado para a área de transferência!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Copiar Bug Report</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: EXPORT TEST RUN REPORT (MARKDOWN & PDF)
      ===================================================================== */}
      {activeTab === 'run_reports' && (
        <div className={`${cardClass} space-y-4`}>
          {runs.length === 0 ? (
            <p className="text-xs text-slate-500">
              Crie uma execução na aba &ldquo;Execuções (Test Runs)&rdquo; para gerar e exportar
              relatórios em Markdown e PDF.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="select-run-export" className="text-xs font-semibold">
                    Execução (Test Run):
                  </label>
                  <select
                    id="select-run-export"
                    value={selectedRun?.id || ''}
                    onChange={(e) => setSelectedRunId(e.target.value)}
                    className={inputClass}
                  >
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.build_version || 'Sem build'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(previewRunMarkdown, 'run-md')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-700 hover:bg-slate-800"
                  >
                    {copiedKey === 'run-md' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Copiar Markdown</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleExportRunReport('md')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    <span>Exportar Markdown (.md)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleExportRunReport('pdf')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    <span>Exportar PDF (.pdf)</span>
                  </button>
                </div>
              </div>

              {exportStatusMsg && (
                <div
                  role="status"
                  className="rounded-xl border bg-emerald-500/15 border-emerald-500/40 text-emerald-400 px-4 py-2.5 text-xs font-medium"
                >
                  {exportStatusMsg}
                </div>
              )}

              <pre
                data-testid="run-report-preview"
                className={`rounded-xl border p-4 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-96 ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-800'
                    : 'bg-slate-950 border-slate-800 text-slate-200'
                }`}
              >
                {previewRunMarkdown}
              </pre>
            </>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 4: SNIPPETS & LOCAL TEST DATA GENERATORS (CPF, CNPJ, JSON, SQL)
      ===================================================================== */}
      {activeTab === 'snippets' && (
        <div className="space-y-5">
          {/* Instant Local Generators */}
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-sm">
                  Geradores Locais de Massa de Teste (CPF, CNPJ, E-mail e UUID)
                </h3>
                <p className="text-xs text-slate-400">
                  Gerados 100% offline com dígitos verificadores válidos (Módulo 11).
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCpfFormatted(generateValidCpf(true));
                  setCpfRaw(generateValidCpf(false));
                  setCnpjFormatted(generateValidCnpj(true));
                  setCnpjRaw(generateValidCnpj(false));
                  setQaEmail(generateQaEmail());
                  setUuidVal(generateUuidV4());
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Gerar Novos Dados</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {[
                { label: 'CPF (com pontuação)', val: cpfFormatted, key: 'cpf-fmt' },
                { label: 'CPF (somente números)', val: cpfRaw, key: 'cpf-raw' },
                { label: 'CNPJ (com pontuação)', val: cnpjFormatted, key: 'cnpj-fmt' },
                { label: 'CNPJ (somente números)', val: cnpjRaw, key: 'cnpj-raw' },
                { label: 'E-mail de Teste QA', val: qaEmail, key: 'qa-email' },
                { label: 'UUID v4', val: uuidVal, key: 'qa-uuid' },
              ].map((item) => (
                <div
                  key={item.key}
                  className={`rounded-xl border p-3 flex items-center justify-between gap-2 ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      {item.label}
                    </div>
                    <div className="font-mono font-bold text-indigo-400 truncate mt-0.5">
                      {item.val}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(item.val, item.key)}
                    aria-label={`Copiar ${item.label}`}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 font-semibold shrink-0 inline-flex items-center gap-1"
                  >
                    {copiedKey === item.key ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Reusable Snippets Library */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Add New Snippet Form */}
            <form
              onSubmit={(e) => void handleCreateSnippet(e)}
              className={`${cardClass} space-y-3`}
            >
              <h3 className="font-bold text-sm flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-indigo-400" />
                <span>Novo Snippet / Massa Reutilizável</span>
              </h3>

              <div>
                <label htmlFor="snip-title" className="block text-xs font-semibold mb-1">
                  Título *
                </label>
                <input
                  id="snip-title"
                  type="text"
                  required
                  value={snipTitle}
                  onChange={(e) => setSnipTitle(e.target.value)}
                  placeholder="Ex.: Payload JSON Webhook Pix"
                  className={`${inputClass} w-full`}
                />
              </div>

              <div>
                <label htmlFor="snip-cat" className="block text-xs font-semibold mb-1">
                  Categoria
                </label>
                <select
                  id="snip-cat"
                  value={snipCategory}
                  onChange={(e) => setSnipCategory(e.target.value as SnippetCategory)}
                  className={`${inputClass} w-full`}
                >
                  {SNIPPET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="snip-content" className="block text-xs font-semibold mb-1">
                  Conteúdo (JSON, SQL, cURL, etc.) *
                </label>
                <textarea
                  id="snip-content"
                  rows={5}
                  required
                  value={snipContent}
                  onChange={(e) => setSnipContent(e.target.value)}
                  placeholder='{"event": "PAYMENT_CONFIRMED"}'
                  className={`${inputClass} w-full font-mono`}
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
              >
                Salvar Snippet
              </button>
            </form>

            {/* Snippets List */}
            <div className="lg:col-span-2 space-y-3">
              {snippets.map((s) => (
                <div key={s.id} className={cardClass}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400">
                        {s.category}
                      </span>
                      <h4 className="font-bold text-sm">{s.title}</h4>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(s.content, `snip-${s.id}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
                      >
                        {copiedKey === `snip-${s.id}` ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => void deleteSnippet(s.id).then(() => reloadData())}
                        aria-label={`Excluir snippet ${s.title}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <pre
                    className={`rounded-xl border p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto ${
                      isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-800'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    {s.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
