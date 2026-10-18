import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  ClipboardCheck,
  ListChecks,
  Layers,
  Tag,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  BugPriority,
  CHECKLIST_CATEGORIES,
  ChecklistCategory,
  ChecklistTemplate,
  PRIORITY_OPTIONS,
  TestCase,
  ThemeMode,
} from '../../types/models';
import {
  createChecklist,
  createTestCase,
  deleteChecklist,
  deleteTestCase,
  listChecklists,
  listTestCases,
  updateChecklist,
  updateTestCase,
} from '../../db/database';

interface TestCasesViewProps {
  theme: ThemeMode;
}

export function TestCasesView({ theme }: TestCasesViewProps) {
  const isLight = theme === 'light';
  const [activeTab, setActiveTab] = useState<'cases' | 'checklists'>('cases');
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [checklists, setChecklists] = useState<ChecklistTemplate[]>([]);

  // Filters for Test Cases
  const [searchQuery, setSearchQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  // Test Case Modal state
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<TestCase | null>(null);
  const [title, setTitle] = useState('');
  const [moduleName, setModuleName] = useState('');
  const [priority, setPriority] = useState<BugPriority>('P2 - Alta');
  const [tagsInput, setTagsInput] = useState('');
  const [preconditions, setPreconditions] = useState('');
  const [steps, setSteps] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [selectedChecklistIdsForCase, setSelectedChecklistIdsForCase] = useState<string[]>([]);

  // Checklist Modal state
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false);
  const [editingChecklist, setEditingChecklist] = useState<ChecklistTemplate | null>(null);
  const [chkName, setChkName] = useState('');
  const [chkCategory, setChkCategory] = useState<ChecklistCategory>('Smoke');
  const [chkDescription, setChkDescription] = useState('');
  const [chkCaseIds, setChkCaseIds] = useState<string[]>([]);

  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const reloadData = useCallback(async () => {
    const [casesData, chkData] = await Promise.all([listTestCases(), listChecklists()]);
    setTestCases(casesData);
    setChecklists(chkData);
  }, []);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  // Open Test Case Modal
  const handleOpenCreateCase = () => {
    setEditingCase(null);
    setTitle('');
    setModuleName('');
    setPriority('P2 - Alta');
    setTagsInput('');
    setPreconditions('');
    setSteps('');
    setExpectedResult('');
    setSelectedChecklistIdsForCase([]);
    setIsCaseModalOpen(true);
  };

  const handleOpenEditCase = (tc: TestCase) => {
    setEditingCase(tc);
    setTitle(tc.title);
    setModuleName(tc.module);
    setPriority(tc.priority);
    setTagsInput(tc.tags.join(', '));
    setPreconditions(tc.preconditions);
    setSteps(tc.steps);
    setExpectedResult(tc.expected_result);
    const belongsTo = checklists
      .filter((chk) => chk.test_case_ids.includes(tc.id))
      .map((chk) => chk.id);
    setSelectedChecklistIdsForCase(belongsTo);
    setIsCaseModalOpen(true);
  };

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    let savedCase: TestCase;
    if (editingCase) {
      savedCase = await updateTestCase(editingCase.id, {
        title,
        module: moduleName,
        priority,
        tags,
        preconditions,
        steps,
        expected_result: expectedResult,
      });
    } else {
      savedCase = await createTestCase({
        title,
        module: moduleName,
        priority,
        tags,
        preconditions,
        steps,
        expected_result: expectedResult,
      });
    }

    // Update checklist memberships for this test case
    for (const chk of checklists) {
      const shouldInclude = selectedChecklistIdsForCase.includes(chk.id);
      const currentlyIncludes = chk.test_case_ids.includes(savedCase.id);
      if (shouldInclude && !currentlyIncludes) {
        await updateChecklist(chk.id, {
          test_case_ids: [...chk.test_case_ids, savedCase.id],
        });
      } else if (!shouldInclude && currentlyIncludes) {
        await updateChecklist(chk.id, {
          test_case_ids: chk.test_case_ids.filter((id) => id !== savedCase.id),
        });
      }
    }

    setIsCaseModalOpen(false);
    await reloadData();
    showNotice(
      editingCase
        ? 'Caso de teste atualizado com sucesso.'
        : 'Novo caso de teste adicionado à biblioteca.',
    );
  };

  const handleDeleteCase = async (id: string) => {
    await deleteTestCase(id);
    await reloadData();
    showNotice('Caso de teste removido.');
  };

  // Open Checklist Modal
  const handleOpenCreateChecklist = () => {
    setEditingChecklist(null);
    setChkName('');
    setChkCategory('Smoke');
    setChkDescription('');
    setChkCaseIds([]);
    setIsChecklistModalOpen(true);
  };

  const handleOpenEditChecklist = (chk: ChecklistTemplate) => {
    setEditingChecklist(chk);
    setChkName(chk.name);
    setChkCategory(chk.category);
    setChkDescription(chk.description);
    setChkCaseIds([...chk.test_case_ids]);
    setIsChecklistModalOpen(true);
  };

  const handleSaveChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chkName.trim()) return;

    if (editingChecklist) {
      await updateChecklist(editingChecklist.id, {
        name: chkName,
        category: chkCategory,
        description: chkDescription,
        test_case_ids: chkCaseIds,
      });
    } else {
      await createChecklist({
        name: chkName,
        category: chkCategory,
        description: chkDescription,
        test_case_ids: chkCaseIds,
      });
    }

    setIsChecklistModalOpen(false);
    await reloadData();
    showNotice(editingChecklist ? 'Checklist atualizado.' : 'Novo checklist reutilizável criado.');
  };

  const handleDeleteChecklist = async (id: string) => {
    await deleteChecklist(id);
    await reloadData();
    showNotice('Checklist removido.');
  };

  const filteredCases = testCases.filter((tc) => {
    if (priorityFilter && tc.priority !== priorityFilter) return false;
    if (moduleFilter && !tc.module.toLowerCase().includes(moduleFilter.toLowerCase())) {
      return false;
    }
    if (tagFilter && !tc.tags.some((t) => t.toLowerCase().includes(tagFilter.toLowerCase()))) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = [tc.title, tc.module, tc.preconditions, tc.steps, tc.expected_result, ...tc.tags]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

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
            Biblioteca de Casos de Teste & Checklists
          </h2>
          <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Organize cenários de teste com pré-condições e passos, e monte templates reutilizáveis
            (Smoke, Regressão e Pré-Release).
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
              onClick={() => setActiveTab('cases')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'cases'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : isLight
                    ? 'text-slate-600 hover:text-slate-900'
                    : 'text-slate-400 hover:text-white'
              }`}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span>Casos de Teste ({testCases.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('checklists')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'checklists'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : isLight
                    ? 'text-slate-600 hover:text-slate-900'
                    : 'text-slate-400 hover:text-white'
              }`}
            >
              <ListChecks className="h-3.5 w-3.5" />
              <span>Checklists / Templates ({checklists.length})</span>
            </button>
          </div>

          {activeTab === 'cases' ? (
            <button
              type="button"
              onClick={handleOpenCreateCase}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Novo Caso de Teste</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenCreateChecklist}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Novo Checklist</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-emerald-500/15 border-emerald-500/40 text-emerald-400 text-xs font-medium"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* TAB 1: TEST CASES LIBRARY */}
      {activeTab === 'cases' && (
        <div className="space-y-4">
          {/* Filters */}
          <div
            className={`rounded-xl border p-3.5 flex flex-wrap items-center gap-2.5 ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900/60 border-slate-800'
            }`}
          >
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Buscar casos de teste"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar caso por título, pré-condições, passos..."
                className={`${inputClass} w-full pl-8`}
              />
            </div>

            <select
              aria-label="Filtrar casos por prioridade"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className={inputClass}
            >
              <option value="">Todas as prioridades</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <input
              type="text"
              aria-label="Filtrar casos por módulo"
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              placeholder="Módulo"
              className={`${inputClass} w-36`}
            />

            <input
              type="text"
              aria-label="Filtrar casos por tag"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="Tag"
              className={`${inputClass} w-32`}
            />
          </div>

          {/* Test Cases List */}
          {filteredCases.length === 0 ? (
            <div
              className={`rounded-2xl border border-dashed p-10 text-center space-y-2 ${
                isLight ? 'border-slate-300 text-slate-500' : 'border-slate-800 text-slate-400'
              }`}
            >
              <ClipboardCheck className="h-8 w-8 mx-auto text-indigo-400 opacity-80" />
              <p className="text-sm font-semibold">Nenhum caso de teste encontrado</p>
              <p className="text-xs">
                Clique em &ldquo;Novo Caso de Teste&rdquo; para cadastrar seus cenários de
                validação.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCases.map((tc) => {
                const linkedChecklists = checklists.filter((chk) =>
                  chk.test_case_ids.includes(tc.id),
                );
                return (
                  <div
                    key={tc.id}
                    className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 transition-colors ${
                      isLight
                        ? 'bg-white border-slate-200 hover:border-indigo-300'
                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                            {tc.priority}
                          </span>
                          {tc.module && (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium ${
                                isLight ? 'text-slate-600' : 'text-slate-300'
                              }`}
                            >
                              <Layers className="h-3 w-3 text-indigo-400" />
                              {tc.module}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenEditCase(tc)}
                            aria-label={`Editar caso ${tc.title}`}
                            className="p-1.5 rounded hover:bg-indigo-500/15 text-indigo-400"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCase(tc.id)}
                            aria-label={`Excluir caso ${tc.title}`}
                            className="p-1.5 rounded hover:bg-rose-500/15 text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <h3 className="font-bold text-sm">{tc.title}</h3>

                      {tc.preconditions && (
                        <div
                          className={`text-xs rounded-lg p-2 ${
                            isLight
                              ? 'bg-slate-50 text-slate-600'
                              : 'bg-slate-950/60 text-slate-400'
                          }`}
                        >
                          <strong className="block text-[10px] uppercase tracking-wider text-indigo-400 mb-0.5">
                            Pré-condições
                          </strong>
                          <p className="whitespace-pre-line line-clamp-2">{tc.preconditions}</p>
                        </div>
                      )}

                      {tc.steps && (
                        <div
                          className={`text-xs rounded-lg p-2 ${
                            isLight
                              ? 'bg-slate-50 text-slate-600'
                              : 'bg-slate-950/60 text-slate-400'
                          }`}
                        >
                          <strong className="block text-[10px] uppercase tracking-wider text-indigo-400 mb-0.5">
                            Passos
                          </strong>
                          <p className="whitespace-pre-line line-clamp-3">{tc.steps}</p>
                        </div>
                      )}

                      {tc.expected_result && (
                        <div
                          className={`text-xs rounded-lg p-2 ${
                            isLight
                              ? 'bg-emerald-50/60 text-slate-700'
                              : 'bg-emerald-950/20 text-slate-300'
                          }`}
                        >
                          <strong className="block text-[10px] uppercase tracking-wider text-emerald-400 mb-0.5">
                            Resultado Esperado
                          </strong>
                          <p className="whitespace-pre-line line-clamp-2">{tc.expected_result}</p>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-800/40 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {tc.tags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400"
                          >
                            <Tag className="h-2.5 w-2.5" />
                            {t}
                          </span>
                        ))}
                      </div>

                      {linkedChecklists.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {linkedChecklists.map((chk) => (
                            <span
                              key={chk.id}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-medium"
                            >
                              {chk.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: REUSABLE CHECKLISTS / TEMPLATES */}
      {activeTab === 'checklists' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {checklists.map((chk) => {
            const includedCases = testCases.filter((tc) => chk.test_case_ids.includes(tc.id));
            return (
              <div
                key={chk.id}
                className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900/70 border-slate-800'
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                      {chk.category}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEditChecklist(chk)}
                        aria-label={`Editar checklist ${chk.name}`}
                        className="p-1.5 rounded hover:bg-indigo-500/15 text-indigo-400"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteChecklist(chk.id)}
                        aria-label={`Excluir checklist ${chk.name}`}
                        className="p-1.5 rounded hover:bg-rose-500/15 text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <h3 className="font-bold text-base">{chk.name}</h3>
                  <p className={`text-xs ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                    {chk.description || 'Template reutilizável para execuções de teste.'}
                  </p>

                  <div className="pt-2 space-y-1.5">
                    <div className="text-xs font-semibold text-indigo-400">
                      Casos vinculados ({includedCases.length})
                    </div>
                    {includedCases.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">
                        Nenhum caso vinculado ainda. Edite o checklist ou o caso de teste para
                        associar.
                      </p>
                    ) : (
                      <ul className="space-y-1 max-h-40 overflow-y-auto text-xs">
                        {includedCases.map((tc) => (
                          <li
                            key={tc.id}
                            className={`px-2.5 py-1.5 rounded-lg border truncate ${
                              isLight
                                ? 'bg-slate-50 border-slate-200 text-slate-700'
                                : 'bg-slate-950/60 border-slate-800 text-slate-300'
                            }`}
                          >
                            • {tc.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL: CREATE / EDIT TEST CASE */}
      {isCaseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingCase ? 'Editar Caso de Teste' : 'Novo Caso de Teste'}
        >
          <div
            className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${
                isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/50'
              }`}
            >
              <h3 className="font-bold text-base">
                {editingCase ? 'Editar Caso de Teste' : 'Novo Caso de Teste'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCaseModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveCase(e)}
              className="p-6 overflow-y-auto space-y-4"
            >
              <div>
                <label htmlFor="tc-title" className={labelClass}>
                  Título do Caso de Teste *
                </label>
                <input
                  id="tc-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Validar pagamento via Pix com QR Code válido"
                  className={`${inputClass} w-full`}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="tc-module" className={labelClass}>
                    Módulo
                  </label>
                  <input
                    id="tc-module"
                    type="text"
                    value={moduleName}
                    onChange={(e) => setModuleName(e.target.value)}
                    placeholder="Ex.: Pagamentos"
                    className={`${inputClass} w-full`}
                  />
                </div>

                <div>
                  <label htmlFor="tc-priority" className={labelClass}>
                    Prioridade
                  </label>
                  <select
                    id="tc-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as BugPriority)}
                    className={`${inputClass} w-full`}
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="tc-tags" className={labelClass}>
                    Tags (separadas por vírgula)
                  </label>
                  <input
                    id="tc-tags"
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="Ex.: smoke, pix, checkout"
                    className={`${inputClass} w-full`}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="tc-preconditions" className={labelClass}>
                  Pré-condições
                </label>
                <textarea
                  id="tc-preconditions"
                  rows={2}
                  value={preconditions}
                  onChange={(e) => setPreconditions(e.target.value)}
                  placeholder="Ex.: Usuário autenticado e com produto ativo no carrinho."
                  className={`${inputClass} w-full`}
                />
              </div>

              <div>
                <label htmlFor="tc-steps" className={labelClass}>
                  Passos
                </label>
                <textarea
                  id="tc-steps"
                  rows={3}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  placeholder={
                    '1. Selecionar forma de pagamento Pix\n2. Clicar em Gerar QR Code\n3. Simular confirmação do webhook'
                  }
                  className={`${inputClass} w-full`}
                />
              </div>

              <div>
                <label htmlFor="tc-expected" className={labelClass}>
                  Resultado Esperado
                </label>
                <textarea
                  id="tc-expected"
                  rows={2}
                  value={expectedResult}
                  onChange={(e) => setExpectedResult(e.target.value)}
                  placeholder="Pedido muda para status Aprovado e exibe comprovante."
                  className={`${inputClass} w-full`}
                />
              </div>

              {/* Link to Checklists */}
              {checklists.length > 0 && (
                <div>
                  <span className={labelClass}>Incluir nos Checklists / Templates:</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {checklists.map((chk) => {
                      const checked = selectedChecklistIdsForCase.includes(chk.id);
                      return (
                        <label
                          key={chk.id}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${
                            checked
                              ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400 font-semibold'
                              : isLight
                                ? 'border-slate-300 bg-slate-50 text-slate-700'
                                : 'border-slate-800 bg-slate-950 text-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedChecklistIdsForCase((prev) => [...prev, chk.id]);
                              } else {
                                setSelectedChecklistIdsForCase((prev) =>
                                  prev.filter((id) => id !== chk.id),
                                );
                              }
                            }}
                          />
                          <span>{chk.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCaseModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  {editingCase ? 'Salvar Caso' : 'Criar Caso de Teste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT CHECKLIST */}
      {isChecklistModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingChecklist ? 'Editar Checklist' : 'Novo Checklist'}
        >
          <div
            className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${
                isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/50'
              }`}
            >
              <h3 className="font-bold text-base">
                {editingChecklist ? 'Editar Checklist Reutilizável' : 'Novo Checklist Reutilizável'}
              </h3>
              <button
                type="button"
                onClick={() => setIsChecklistModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveChecklist(e)}
              className="p-6 overflow-y-auto space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label htmlFor="chk-name" className={labelClass}>
                    Nome do Checklist *
                  </label>
                  <input
                    id="chk-name"
                    type="text"
                    required
                    value={chkName}
                    onChange={(e) => setChkName(e.target.value)}
                    placeholder="Ex.: Smoke Test Checkout"
                    className={`${inputClass} w-full`}
                  />
                </div>

                <div>
                  <label htmlFor="chk-category" className={labelClass}>
                    Categoria
                  </label>
                  <select
                    id="chk-category"
                    value={chkCategory}
                    onChange={(e) => setChkCategory(e.target.value as ChecklistCategory)}
                    className={`${inputClass} w-full`}
                  >
                    {CHECKLIST_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="chk-desc" className={labelClass}>
                  Descrição
                </label>
                <input
                  id="chk-desc"
                  type="text"
                  value={chkDescription}
                  onChange={(e) => setChkDescription(e.target.value)}
                  placeholder="Objetivo deste template de execução..."
                  className={`${inputClass} w-full`}
                />
              </div>

              <div>
                <span className={labelClass}>
                  Casos de Teste incluídos neste Checklist ({chkCaseIds.length})
                </span>
                {testCases.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Cadastre casos de teste na biblioteca para selecioná-los aqui.
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-800 rounded-xl p-3">
                    {testCases.map((tc) => {
                      const checked = chkCaseIds.includes(tc.id);
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
                                setChkCaseIds((prev) => [...prev, tc.id]);
                              } else {
                                setChkCaseIds((prev) => prev.filter((id) => id !== tc.id));
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
                  onClick={() => setIsChecklistModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  Salvar Checklist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
