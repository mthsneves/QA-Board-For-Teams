import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PlayCircle,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  Bug,
  Paperclip,
  Trash2,
  Compass,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  X,
  Clock,
  Send,
} from 'lucide-react';
import {
  AttachmentRecord,
  BugCard,
  BugSeverity,
  ChecklistTemplate,
  ExploratorySession,
  SEVERITY_OPTIONS,
  TestCase,
  TestRun,
  TestRunItem,
  TestRunItemStatus,
  ThemeMode,
} from '../../types/models';
import {
  buildSlackRunSummaryPreview,
  createBug,
  createExploratorySession,
  createTestRun,
  deleteAttachment,
  deleteExploratorySession,
  deleteTestRun,
  generateBugFromRunItem,
  getAttachmentDataUrl,
  listAllAttachments,
  listBugs,
  listChecklists,
  listColumns,
  listExploratorySessions,
  listTestCases,
  listTestRunItems,
  listTestRuns,
  saveAttachmentForParent,
  sendSlackRunSummary,
  updateExploratorySession,
  updateTestRunItem,
} from '../../db/database';
import { AttachmentPreviewModal } from '../bugs/AttachmentPreviewModal';

interface TestRunsViewProps {
  theme: ThemeMode;
  onNavigateToBugs?: () => void;
}

function formatDuration(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

function fileToBase64(file: File): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({ base64, dataUrl: result });
    };
    reader.onerror = () => reject(new Error('Erro ao ler anexo.'));
    reader.readAsDataURL(file);
  });
}

export function TestRunsView({ theme, onNavigateToBugs }: TestRunsViewProps) {
  const isLight = theme === 'light';
  const [activeTab, setActiveTab] = useState<'runs' | 'exploratory'>('runs');

  const [runs, setRuns] = useState<TestRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runItems, setRunItems] = useState<TestRunItem[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [checklists, setChecklists] = useState<ChecklistTemplate[]>([]);
  const [itemAttachments, setItemAttachments] = useState<Record<string, AttachmentRecord[]>>({});
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  // New Run Modal state
  const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
  const [runName, setRunName] = useState('');
  const [runBuild, setRunBuild] = useState('');
  const [runEnv, setRunEnv] = useState('Homologação');
  const [selectedChecklistId, setSelectedChecklistId] = useState('');
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);

  // Exploratory Sessions state
  const [sessions, setSessions] = useState<ExploratorySession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionBugs, setSessionBugs] = useState<BugCard[]>([]);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerSecondsRef = useRef(0);

  // New Exploratory Session Modal
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [charterInput, setCharterInput] = useState('');
  const [sessionEnvInput, setSessionEnvInput] = useState('Homologação');
  const [sessionBuildInput, setSessionBuildInput] = useState('');
  const [sessionModuleInput, setSessionModuleInput] = useState('');

  // Quick Bug in Exploratory Session Modal
  const [isSessionBugModalOpen, setIsSessionBugModalOpen] = useState(false);
  const [sessionBugTitle, setSessionBugTitle] = useState('');
  const [sessionBugSeverity, setSessionBugSeverity] = useState<BugSeverity>('Alta');
  const [sessionBugActual, setSessionBugActual] = useState('');

  const [isSlackModalOpen, setIsSlackModalOpen] = useState(false);
  const [isSendingSlack, setIsSendingSlack] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<{
    record: AttachmentRecord;
    url: string;
  } | null>(null);

  const showNotice = (msg: string) => {
    setErrorMsg(null);
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const reloadAll = useCallback(async () => {
    const [runsList, casesList, chkList, expList, allBugs] = await Promise.all([
      listTestRuns(),
      listTestCases(),
      listChecklists(),
      listExploratorySessions(),
      listBugs(),
    ]);
    setRuns(runsList);
    setTestCases(casesList);
    setChecklists(chkList);
    setSessions(expList);

    const activeRunId =
      selectedRunId && runsList.some((r) => r.id === selectedRunId)
        ? selectedRunId
        : runsList[0]?.id || null;
    setSelectedRunId(activeRunId);

    if (activeRunId) {
      const [items, allAtts] = await Promise.all([
        listTestRunItems(activeRunId),
        listAllAttachments(),
      ]);
      setRunItems(items);

      const grouped: Record<string, AttachmentRecord[]> = {};
      const urls: Record<string, string> = {};
      for (const att of allAtts) {
        if (att.parent_type === 'run_item') {
          grouped[att.parent_id] = grouped[att.parent_id] || [];
          grouped[att.parent_id].push(att);
          try {
            urls[att.id] = await getAttachmentDataUrl(att);
          } catch {
            urls[att.id] = '';
          }
        }
      }
      setItemAttachments(grouped);
      setAttachmentUrls(urls);
    } else {
      setRunItems([]);
    }

    const activeExpId =
      selectedSessionId && expList.some((s) => s.id === selectedSessionId)
        ? selectedSessionId
        : expList[0]?.id || null;
    setSelectedSessionId(activeExpId);
    if (activeExpId) {
      const currentSession = expList.find((s) => s.id === activeExpId);
      if (currentSession && !isTimerRunning) {
        setTimerSeconds(currentSession.duration_seconds);
        timerSecondsRef.current = currentSession.duration_seconds;
      }
      setSessionBugs(allBugs.filter((b) => b.exploratory_session_id === activeExpId));
    } else {
      setSessionBugs([]);
    }
  }, [selectedRunId, selectedSessionId, isTimerRunning]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  // Exploratory Session Timer interval
  useEffect(() => {
    if (!isTimerRunning || !selectedSessionId) return;
    const interval = setInterval(() => {
      setTimerSeconds((prev) => {
        const next = prev + 1;
        timerSecondsRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerRunning, selectedSessionId]);

  const selectedRun = runs.find((r) => r.id === selectedRunId) || null;
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || null;

  // Checklist selection auto-selects test cases
  const handleSelectChecklistForNewRun = (chkId: string) => {
    setSelectedChecklistId(chkId);
    if (!chkId) return;
    const chk = checklists.find((c) => c.id === chkId);
    if (chk) {
      setSelectedCaseIds([...chk.test_case_ids]);
    }
  };

  const handleOpenNewRunModal = () => {
    setErrorMsg(null);
    setRunName('');
    setRunBuild('');
    setRunEnv('Homologação');
    setSelectedChecklistId('');
    setSelectedCaseIds(testCases.map((tc) => tc.id));
    setIsNewRunModalOpen(true);
  };

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const created = await createTestRun({
        name: runName,
        build_version: runBuild,
        environment: runEnv,
        checklist_id: selectedChecklistId || null,
        test_case_ids: selectedCaseIds,
      });
      setIsNewRunModalOpen(false);
      setSelectedRunId(created.id);
      await reloadAll();
      showNotice(`Execução "${created.name}" iniciada com sucesso!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao criar execução.');
    }
  };

  const handleStatusChange = async (item: TestRunItem, status: TestRunItemStatus) => {
    await updateTestRunItem(item.id, { status });
    await reloadAll();
  };

  const handleNotesChange = async (itemId: string, notes: string) => {
    setRunItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, notes } : i)));
    await updateTestRunItem(itemId, { notes });
  };

  const handleAddRunItemAttachment = async (itemId: string, files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const mimeType = file.type || 'image/png';
      if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) continue;
      const { base64 } = await fileToBase64(file);
      const fileName =
        file.name && file.name !== 'image.png' ? file.name : `evidencia-run-${Date.now()}.png`;
      await saveAttachmentForParent({
        parentType: 'run_item',
        parentId: itemId,
        fileName,
        mimeType,
        base64Data: base64,
      });
    }
    await reloadAll();
    showNotice('Evidência anexada ao item da execução.');
  };

  const handleGenerateBugFromFailure = async (item: TestRunItem) => {
    if (!selectedRun) return;
    const bug = await generateBugFromRunItem(selectedRun, item);
    await reloadAll();
    showNotice(`Card de bug "${bug.title}" criado automaticamente no Board Kanban!`);
  };

  // Exploratory Session Handlers
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!charterInput.trim()) return;
    const created = await createExploratorySession({
      charter: charterInput,
      environment: sessionEnvInput,
      build_version: sessionBuildInput,
      module: sessionModuleInput,
      notes: '',
      duration_seconds: 0,
    });
    setIsNewSessionModalOpen(false);
    setCharterInput('');
    setSelectedSessionId(created.id);
    setTimerSeconds(0);
    timerSecondsRef.current = 0;
    await reloadAll();
    showNotice('Nova sessão exploratória criada.');
  };

  const handleToggleTimer = async () => {
    if (!selectedSession) return;
    if (isTimerRunning) {
      setIsTimerRunning(false);
      await updateExploratorySession(selectedSession.id, {
        duration_seconds: timerSecondsRef.current,
      });
      await reloadAll();
    } else {
      setIsTimerRunning(true);
    }
  };

  const handleResetTimer = async () => {
    if (!selectedSession) return;
    setIsTimerRunning(false);
    setTimerSeconds(0);
    timerSecondsRef.current = 0;
    await updateExploratorySession(selectedSession.id, { duration_seconds: 0 });
    await reloadAll();
  };

  const handleUpdateSessionNotes = async (notes: string) => {
    if (!selectedSession) return;
    setSessions((prev) => prev.map((s) => (s.id === selectedSession.id ? { ...s, notes } : s)));
    await updateExploratorySession(selectedSession.id, {
      notes,
      duration_seconds: timerSecondsRef.current,
    });
  };

  const handleCreateBugInSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !sessionBugTitle.trim()) return;
    const cols = await listColumns();
    await createBug({
      column_id: cols[0]?.id || 'col-new',
      title: sessionBugTitle,
      severity: sessionBugSeverity,
      priority: sessionBugSeverity === 'Crítica' ? 'P1 - Urgente' : 'P2 - Alta',
      environment: selectedSession.environment,
      build_version: selectedSession.build_version,
      module: selectedSession.module,
      tags: ['exploratório'],
      steps_to_reproduce: `Encontrado durante a sessão exploratória:\nMissão: ${selectedSession.charter}`,
      expected_result: 'Comportamento adequado sem falhas.',
      actual_result: sessionBugActual,
      external_ticket_url: '',
      exploratory_session_id: selectedSession.id,
    });
    setIsSessionBugModalOpen(false);
    setSessionBugTitle('');
    setSessionBugActual('');
    await reloadAll();
    showNotice('Bug registrado na sessão exploratória e adicionado ao Kanban!');
  };

  // Run Statistics
  const totalItems = runItems.length;
  const passedCount = runItems.filter((i) => i.status === 'Passou').length;
  const failedCount = runItems.filter((i) => i.status === 'Falhou').length;
  const blockedCount = runItems.filter((i) => i.status === 'Bloqueado').length;
  const skippedCount = runItems.filter((i) => i.status === 'Pulado').length;

  const inputClass = `rounded-lg border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
    isLight
      ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
      : 'bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-500'
  }`;

  const labelClass = `block text-xs font-semibold mb-1 ${
    isLight ? 'text-slate-700' : 'text-slate-300'
  }`;

  return (
    <div className="space-y-5">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Execuções de Teste (Test Runs) & Sessões Exploratórias
          </h2>
          <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Execute baterias por build/ambiente, gere cards de bug com 1 clique a partir de falhas e
            conduza sessões exploratórias cronometradas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`inline-flex rounded-xl p-1 border ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveTab('runs')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'runs'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : isLight
                    ? 'text-slate-600 hover:text-slate-900'
                    : 'text-slate-400 hover:text-white'
              }`}
            >
              <PlayCircle className="h-3.5 w-3.5" />
              <span>Test Runs ({runs.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('exploratory')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'exploratory'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : isLight
                    ? 'text-slate-600 hover:text-slate-900'
                    : 'text-slate-400 hover:text-white'
              }`}
            >
              <Compass className="h-3.5 w-3.5" />
              <span>Sessões Exploratórias ({sessions.length})</span>
            </button>
          </div>

          {activeTab === 'runs' ? (
            <button
              type="button"
              onClick={handleOpenNewRunModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Nova Execução</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsNewSessionModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Nova Sessão Exploratória</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border bg-emerald-500/15 border-emerald-500/40 text-emerald-400 text-xs font-medium"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </span>
          {onNavigateToBugs && notice.includes('Board') && (
            <button
              type="button"
              onClick={onNavigateToBugs}
              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-semibold"
            >
              Ver no Board de Bugs →
            </button>
          )}
        </div>
      )}

      {/* TAB 1: TEST RUNS */}
      {activeTab === 'runs' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Left Column: Runs List */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Histórico de Execuções
            </h3>
            {runs.length === 0 ? (
              <div
                className={`rounded-xl border border-dashed p-5 text-center text-xs ${
                  isLight ? 'border-slate-300 text-slate-500' : 'border-slate-800 text-slate-400'
                }`}
              >
                Nenhuma execução criada ainda.
              </div>
            ) : (
              runs.map((run) => {
                const isSelected = run.id === selectedRunId;
                return (
                  <div
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-start justify-between gap-2 ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30'
                        : isLight
                          ? 'bg-white border-slate-200 hover:border-indigo-300'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="font-bold text-sm truncate">{run.name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        {run.build_version && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-mono">
                            {run.build_version}
                          </span>
                        )}
                        {run.environment && <span>• {run.environment}</span>}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(run.created_at).toLocaleString('pt-BR')}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteTestRun(run.id).then(() => reloadAll());
                      }}
                      aria-label={`Excluir execução ${run.name}`}
                      className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Area: Selected Run Execution */}
          <div className="lg:col-span-3 space-y-4">
            {!selectedRun ? (
              <div
                className={`rounded-2xl border border-dashed p-12 text-center space-y-2 ${
                  isLight ? 'border-slate-300 text-slate-500' : 'border-slate-800 text-slate-400'
                }`}
              >
                <PlayCircle className="h-9 w-9 mx-auto text-indigo-400 opacity-80" />
                <p className="text-sm font-semibold">Selecione ou crie uma Execução de Teste</p>
                <p className="text-xs">
                  Escolha casos da biblioteca ou um checklist (Smoke, Regressão, Pré-Release) para
                  iniciar.
                </p>
              </div>
            ) : (
              <>
                {/* Run Summary Card */}
                <div
                  className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-4 ${
                    isLight ? 'bg-white border-slate-200' : 'bg-slate-900/70 border-slate-800'
                  }`}
                >
                  <div>
                    <h3 className="text-base font-bold">{selectedRun.name}</h3>
                    <p className="text-xs text-slate-400">
                      Ambiente: <strong>{selectedRun.environment || 'N/A'}</strong> • Build:{' '}
                      <strong>{selectedRun.build_version || 'N/A'}</strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      Passou: {passedCount}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30">
                      Falhou: {failedCount}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      Bloqueado: {blockedCount}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-500/15 text-slate-400 border border-slate-500/30">
                      Pulado: {skippedCount}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-400">
                      Total: {totalItems}
                    </span>
                    <button
                      type="button"
                      data-testid="open-slack-preview-btn"
                      onClick={() => {
                        setErrorMsg(null);
                        setIsSlackModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Enviar Resumo no Slack</span>
                    </button>
                  </div>
                </div>

                {/* Run Items List */}
                <div className="space-y-3">
                  {runItems.map((item) => {
                    const atts = itemAttachments[item.id] || [];
                    return (
                      <div
                        key={item.id}
                        data-testid={`run-item-${item.id}`}
                        onPaste={(e) => {
                          const files: File[] = [];
                          for (let i = 0; i < (e.clipboardData?.items.length || 0); i++) {
                            const clipItem = e.clipboardData.items[i];
                            if (
                              clipItem.type.startsWith('image/') ||
                              clipItem.type.startsWith('video/')
                            ) {
                              const f = clipItem.getAsFile();
                              if (f) files.push(f);
                            }
                          }
                          if (files.length > 0) {
                            e.preventDefault();
                            void handleAddRunItemAttachment(item.id, files);
                          }
                        }}
                        className={`rounded-2xl border p-4 space-y-3 transition-colors ${
                          item.status === 'Falhou'
                            ? 'border-rose-500/50 bg-rose-950/10'
                            : item.status === 'Passou'
                              ? 'border-emerald-500/40 bg-emerald-950/5'
                              : isLight
                                ? 'bg-white border-slate-200'
                                : 'bg-slate-900/60 border-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400">
                                {item.priority}
                              </span>
                              {item.module && (
                                <span className="text-xs text-slate-400">{item.module}</span>
                              )}
                              <span
                                className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                  item.status === 'Passou'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : item.status === 'Falhou'
                                      ? 'bg-rose-500/20 text-rose-400'
                                      : item.status === 'Bloqueado'
                                        ? 'bg-amber-500/20 text-amber-400'
                                        : 'bg-slate-700/40 text-slate-300'
                                }`}
                              >
                                {item.status}
                              </span>
                            </div>
                            <h4 className="font-bold text-sm">{item.title}</h4>
                          </div>

                          {/* Status Execution Buttons */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleStatusChange(item, 'Passou')}
                              aria-label={`Marcar ${item.title} como Passou`}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                item.status === 'Passou'
                                  ? 'bg-emerald-600 text-white border-emerald-500'
                                  : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15'
                              }`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Passou</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleStatusChange(item, 'Falhou')}
                              aria-label={`Marcar ${item.title} como Falhou`}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                item.status === 'Falhou'
                                  ? 'bg-rose-600 text-white border-rose-500'
                                  : 'border-rose-500/30 text-rose-400 hover:bg-rose-500/15'
                              }`}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              <span>Falhou</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleStatusChange(item, 'Bloqueado')}
                              aria-label={`Marcar ${item.title} como Bloqueado`}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                item.status === 'Bloqueado'
                                  ? 'bg-amber-600 text-white border-amber-500'
                                  : 'border-amber-500/30 text-amber-400 hover:bg-amber-500/15'
                              }`}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>Bloqueado</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleStatusChange(item, 'Pulado')}
                              aria-label={`Marcar ${item.title} como Pulado`}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                item.status === 'Pulado'
                                  ? 'bg-slate-600 text-white border-slate-500'
                                  : 'border-slate-600/40 text-slate-400 hover:bg-slate-700/30'
                              }`}
                            >
                              <SkipForward className="h-3.5 w-3.5" />
                              <span>Pulado</span>
                            </button>
                          </div>
                        </div>

                        {/* Steps & Expected Result Reference */}
                        {(item.steps || item.expected_result) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            {item.steps && (
                              <div
                                className={`rounded-lg p-2.5 ${
                                  isLight
                                    ? 'bg-slate-50 text-slate-700'
                                    : 'bg-slate-950/60 text-slate-300'
                                }`}
                              >
                                <strong className="block text-[10px] uppercase text-indigo-400 mb-0.5">
                                  Passos
                                </strong>
                                <p className="whitespace-pre-line">{item.steps}</p>
                              </div>
                            )}
                            {item.expected_result && (
                              <div
                                className={`rounded-lg p-2.5 ${
                                  isLight
                                    ? 'bg-slate-50 text-slate-700'
                                    : 'bg-slate-950/60 text-slate-300'
                                }`}
                              >
                                <strong className="block text-[10px] uppercase text-emerald-400 mb-0.5">
                                  Resultado Esperado
                                </strong>
                                <p className="whitespace-pre-line">{item.expected_result}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Notes + Attachments + Generate Bug from Failure */}
                        <div className="space-y-2 pt-1">
                          <textarea
                            rows={2}
                            aria-label={`Observação para ${item.title}`}
                            value={item.notes}
                            onChange={(e) => void handleNotesChange(item.id, e.target.value)}
                            placeholder="Observações da execução / Resultado obtido (você também pode colar um print com Ctrl+V aqui)..."
                            className={`${inputClass} w-full`}
                          />

                          {/* Item Attachments */}
                          {atts.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {atts.map((att) => {
                                const url = attachmentUrls[att.id] || '';
                                return (
                                  <div
                                    key={att.id}
                                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 text-xs"
                                  >
                                    <Paperclip className="h-3 w-3 text-indigo-400" />
                                    <span className="truncate max-w-[140px]">{att.file_name}</span>
                                    {url && (
                                      <button
                                        type="button"
                                        onClick={() => setPreviewItem({ record: att, url })}
                                        className="text-indigo-400 hover:text-indigo-300"
                                        title="Ampliar anexo"
                                      >
                                        <Maximize2 className="h-3 w-3" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void deleteAttachment(att.id).then(() => reloadAll())
                                      }
                                      className="text-rose-400 hover:text-rose-300"
                                      title="Remover anexo"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer">
                              <Paperclip className="h-3.5 w-3.5" />
                              <span>Anexar print/vídeo</span>
                              <input
                                type="file"
                                accept="image/*,video/*"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files) {
                                    void handleAddRunItemAttachment(item.id, e.target.files);
                                    e.target.value = '';
                                  }
                                }}
                              />
                            </label>

                            <div className="flex items-center gap-2">
                              {item.created_bug_id && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                  <Bug className="h-3.5 w-3.5" />
                                  <span>Bug gerado no Board</span>
                                </span>
                              )}

                              {(item.status === 'Falhou' || !item.created_bug_id) && (
                                <button
                                  type="button"
                                  onClick={() => void handleGenerateBugFromFailure(item)}
                                  aria-label={`Gerar bug a partir de falha em ${item.title}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500 transition-colors shadow-xs"
                                >
                                  <Bug className="h-3.5 w-3.5" />
                                  <span>Gerar Bug a partir de Falha</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: EXPLORATORY SESSIONS */}
      {activeTab === 'exploratory' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Left: Sessions List */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Sessões Exploratórias
            </h3>
            {sessions.length === 0 ? (
              <div
                className={`rounded-xl border border-dashed p-5 text-center text-xs ${
                  isLight ? 'border-slate-300 text-slate-500' : 'border-slate-800 text-slate-400'
                }`}
              >
                Nenhuma sessão exploratória criada.
              </div>
            ) : (
              sessions.map((s) => {
                const isSelected = s.id === selectedSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      setIsTimerRunning(false);
                      setSelectedSessionId(s.id);
                      setTimerSeconds(s.duration_seconds);
                      timerSecondsRef.current = s.duration_seconds;
                    }}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-start justify-between gap-2 ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30'
                        : isLight
                          ? 'bg-white border-slate-200 hover:border-indigo-300'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="font-bold text-xs line-clamp-2">{s.charter}</div>
                      <div className="text-[11px] text-indigo-400 font-mono">
                        ⏱ {formatDuration(s.duration_seconds)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteExploratorySession(s.id).then(() => reloadAll());
                      }}
                      aria-label={`Excluir sessão ${s.charter}`}
                      className="p-1 rounded text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Right: Active Exploratory Session Details */}
          <div className="lg:col-span-3 space-y-4">
            {!selectedSession ? (
              <div
                className={`rounded-2xl border border-dashed p-12 text-center space-y-2 ${
                  isLight ? 'border-slate-300 text-slate-500' : 'border-slate-800 text-slate-400'
                }`}
              >
                <Compass className="h-9 w-9 mx-auto text-indigo-400 opacity-80" />
                <p className="text-sm font-semibold">Inicie uma Sessão de Teste Exploratório</p>
                <p className="text-xs">
                  Defina uma missão (Charter), acione o cronômetro, registre notas rápidas e vincule
                  os bugs encontrados.
                </p>
              </div>
            ) : (
              <div
                className={`rounded-2xl border p-6 space-y-5 ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900/70 border-slate-800'
                }`}
              >
                {/* Charter & Timer Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/60">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                      Missão (Charter)
                    </span>
                    <h3 className="text-base font-bold">{selectedSession.charter}</h3>
                    <p className="text-xs text-slate-400">
                      Módulo: <strong>{selectedSession.module || 'Geral'}</strong> • Ambiente:{' '}
                      <strong>{selectedSession.environment || 'N/A'}</strong> • Build:{' '}
                      <strong>{selectedSession.build_version || 'N/A'}</strong>
                    </p>
                  </div>

                  {/* Timer Control */}
                  <div className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5">
                    <Clock className="h-4 w-4 text-indigo-400" />
                    <span
                      data-testid="exploratory-timer"
                      className="font-mono text-lg font-bold text-indigo-300"
                    >
                      {formatDuration(timerSeconds)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleToggleTimer()}
                      className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 inline-flex items-center gap-1"
                    >
                      {isTimerRunning ? (
                        <>
                          <Pause className="h-3.5 w-3.5" />
                          <span>Pausar</span>
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" />
                          <span>Iniciar</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResetTimer()}
                      title="Zerar timer"
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Quick Notes */}
                <div>
                  <label htmlFor="exp-notes" className={labelClass}>
                    Anotações Rápidas da Sessão
                  </label>
                  <textarea
                    id="exp-notes"
                    rows={6}
                    value={selectedSession.notes}
                    onChange={(e) => void handleUpdateSessionNotes(e.target.value)}
                    placeholder="Anote ideias de teste, fluxos explorados, dúvidas de regra de negócio e comportamentos observados..."
                    className={`${inputClass} w-full`}
                  />
                </div>

                {/* Bugs Found in Session */}
                <div className="space-y-3 pt-2 border-t border-slate-800/60">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                      Bugs Encontrados na Sessão ({sessionBugs.length})
                    </h4>
                    <button
                      type="button"
                      onClick={() => setIsSessionBugModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500"
                    >
                      <Bug className="h-3.5 w-3.5" />
                      <span>Registrar Bug na Sessão</span>
                    </button>
                  </div>

                  {sessionBugs.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">
                      Nenhum bug registrado nesta sessão ainda.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {sessionBugs.map((b) => (
                        <div
                          key={b.id}
                          className={`rounded-xl border p-3 flex items-center justify-between gap-2 ${
                            isLight
                              ? 'bg-slate-50 border-slate-200'
                              : 'bg-slate-950/60 border-slate-800'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{b.title}</div>
                            <div className="text-[10px] text-rose-400 font-semibold">
                              Severidade: {b.severity}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: NEW TEST RUN */}
      {isNewRunModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Nova Execução de Teste"
        >
          <div
            className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base">Nova Execução de Teste (Test Run)</h3>
              <button
                type="button"
                onClick={() => setIsNewRunModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleCreateRun(e)}
              className="p-6 overflow-y-auto space-y-4"
            >
              {errorMsg && (
                <div className="rounded-lg bg-rose-500/15 border border-rose-500/40 px-3 py-2 text-xs text-rose-400">
                  {errorMsg}
                </div>
              )}

              <div>
                <label htmlFor="run-name" className={labelClass}>
                  Nome da Execução *
                </label>
                <input
                  id="run-name"
                  type="text"
                  required
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  placeholder="Ex.: Regressão Release v2.4"
                  className={`${inputClass} w-full`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="run-build" className={labelClass}>
                    Versão / Build
                  </label>
                  <input
                    id="run-build"
                    type="text"
                    value={runBuild}
                    onChange={(e) => setRunBuild(e.target.value)}
                    placeholder="Ex.: v2.4.0"
                    className={`${inputClass} w-full`}
                  />
                </div>

                <div>
                  <label htmlFor="run-env" className={labelClass}>
                    Ambiente
                  </label>
                  <input
                    id="run-env"
                    type="text"
                    value={runEnv}
                    onChange={(e) => setRunEnv(e.target.value)}
                    placeholder="Ex.: Homologação"
                    className={`${inputClass} w-full`}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="run-checklist" className={labelClass}>
                  Carregar de Checklist / Template (opcional)
                </label>
                <select
                  id="run-checklist"
                  value={selectedChecklistId}
                  onChange={(e) => handleSelectChecklistForNewRun(e.target.value)}
                  className={`${inputClass} w-full`}
                >
                  <option value="">Selecionar manualmente os casos de teste</option>
                  {checklists.map((chk) => (
                    <option key={chk.id} value={chk.id}>
                      {chk.name} ({chk.category} - {chk.test_case_ids.length} casos)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className={labelClass}>
                  Casos de Teste Selecionados ({selectedCaseIds.length})
                </span>
                {testCases.length === 0 ? (
                  <p className="text-xs text-rose-400">
                    Nenhum caso de teste cadastrado ainda. Cadastre um caso na aba &ldquo;Casos de
                    Teste&rdquo; primeiro.
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-800 rounded-xl p-3">
                    {testCases.map((tc) => {
                      const checked = selectedCaseIds.includes(tc.id);
                      return (
                        <label
                          key={tc.id}
                          className="flex items-center gap-2.5 text-xs cursor-pointer py-1"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCaseIds((prev) => [...prev, tc.id]);
                              } else {
                                setSelectedCaseIds((prev) => prev.filter((id) => id !== tc.id));
                              }
                            }}
                          />
                          <span className="font-medium">{tc.title}</span>
                          {tc.module && (
                            <span className="text-[10px] text-indigo-400">({tc.module})</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewRunModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  Iniciar Execução
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NEW EXPLORATORY SESSION */}
      {isNewSessionModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Nova Sessão Exploratória"
        >
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base">Nova Sessão Exploratória</h3>
              <button
                type="button"
                onClick={() => setIsNewSessionModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateSession(e)} className="p-6 space-y-4">
              <div>
                <label htmlFor="exp-charter" className={labelClass}>
                  Missão (Charter) *
                </label>
                <input
                  id="exp-charter"
                  type="text"
                  required
                  value={charterInput}
                  onChange={(e) => setCharterInput(e.target.value)}
                  placeholder="Ex.: Explorar edição de perfil com conexões lentas e uploads grandes"
                  className={`${inputClass} w-full`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="exp-module" className={labelClass}>
                    Módulo
                  </label>
                  <input
                    id="exp-module"
                    type="text"
                    value={sessionModuleInput}
                    onChange={(e) => setSessionModuleInput(e.target.value)}
                    placeholder="Ex.: Perfil"
                    className={`${inputClass} w-full`}
                  />
                </div>

                <div>
                  <label htmlFor="exp-env" className={labelClass}>
                    Ambiente
                  </label>
                  <input
                    id="exp-env"
                    type="text"
                    value={sessionEnvInput}
                    onChange={(e) => setSessionEnvInput(e.target.value)}
                    placeholder="Homologação"
                    className={`${inputClass} w-full`}
                  />
                </div>

                <div>
                  <label htmlFor="exp-build" className={labelClass}>
                    Build
                  </label>
                  <input
                    id="exp-build"
                    type="text"
                    value={sessionBuildInput}
                    onChange={(e) => setSessionBuildInput(e.target.value)}
                    placeholder="v2.4.0"
                    className={`${inputClass} w-full`}
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewSessionModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  Criar Sessão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REGISTER BUG IN EXPLORATORY SESSION */}
      {isSessionBugModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Registrar Bug na Sessão"
        >
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base">Registrar Bug Encontrado na Sessão</h3>
              <button
                type="button"
                onClick={() => setIsSessionBugModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateBugInSession(e)} className="p-6 space-y-4">
              <div>
                <label htmlFor="sbug-title" className={labelClass}>
                  Título do Bug *
                </label>
                <input
                  id="sbug-title"
                  type="text"
                  required
                  value={sessionBugTitle}
                  onChange={(e) => setSessionBugTitle(e.target.value)}
                  placeholder="Ex.: Erro 413 sem tratamento ao enviar foto de 10MB"
                  className={`${inputClass} w-full`}
                />
              </div>

              <div>
                <label htmlFor="sbug-severity" className={labelClass}>
                  Severidade
                </label>
                <select
                  id="sbug-severity"
                  value={sessionBugSeverity}
                  onChange={(e) => setSessionBugSeverity(e.target.value as BugSeverity)}
                  className={`${inputClass} w-full`}
                >
                  {SEVERITY_OPTIONS.map((sev) => (
                    <option key={sev} value={sev}>
                      {sev}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sbug-actual" className={labelClass}>
                  Resultado Obtido / Comportamento Observado
                </label>
                <textarea
                  id="sbug-actual"
                  rows={3}
                  value={sessionBugActual}
                  onChange={(e) => setSessionBugActual(e.target.value)}
                  placeholder="Descreva o que aconteceu..."
                  className={`${inputClass} w-full`}
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSessionBugModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500"
                >
                  Criar Bug na Sessão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Slack Run Summary Preview Modal */}
      {isSlackModalOpen && selectedRun && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pré-visualizar Resumo para o Slack"
        >
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Send className="h-4 w-4 text-emerald-400" />
                  Pré-visualização da Mensagem (Slack)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Revise o resumo da execução antes de enviá-lo pelo Incoming Webhook configurado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSlackModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {errorMsg && (
                <div className="rounded-lg bg-rose-500/15 border border-rose-500/40 px-3.5 py-2 text-xs text-rose-400">
                  {errorMsg}
                </div>
              )}

              <div>
                <span className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Mensagem formatada que será enviada:
                </span>
                <pre
                  data-testid="slack-preview-content"
                  className={`rounded-xl border p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto ${
                    isLight
                      ? 'bg-slate-50 border-slate-200 text-slate-800'
                      : 'bg-slate-950 border-slate-800 text-slate-200'
                  }`}
                >
                  {buildSlackRunSummaryPreview(selectedRun, runItems)}
                </pre>
              </div>

              <div className="pt-3 border-t border-slate-800/60 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSlackModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  data-testid="confirm-send-slack-btn"
                  disabled={isSendingSlack}
                  onClick={async () => {
                    setErrorMsg(null);
                    setIsSendingSlack(true);
                    try {
                      const msg = await sendSlackRunSummary(selectedRun, runItems);
                      setIsSlackModalOpen(false);
                      showNotice(msg);
                    } catch (err) {
                      setErrorMsg(err instanceof Error ? err.message : String(err));
                    } finally {
                      setIsSendingSlack(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{isSendingSlack ? 'Enviando...' : 'Enviar para o Slack'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AttachmentPreviewModal
        attachment={previewItem?.record ?? null}
        dataUrl={previewItem?.url ?? null}
        onClose={() => setPreviewItem(null)}
      />
    </div>
  );
}
