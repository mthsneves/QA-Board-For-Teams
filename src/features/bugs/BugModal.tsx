import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Upload,
  Trash2,
  Maximize2,
  Film,
  ClipboardPaste,
  ExternalLink,
  Clock,
  RefreshCw,
  Send,
} from 'lucide-react';
import {
  AttachmentRecord,
  BoardColumn,
  BugCard,
  BugInput,
  BugPriority,
  BugSeverity,
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
  ThemeMode,
} from '../../types/models';
import {
  deleteAttachment,
  getAttachmentDataUrl,
  listAttachmentsForParent,
  saveAttachmentForParent,
} from '../../db/database';
import { AttachmentPreviewModal } from './AttachmentPreviewModal';

export interface PendingAttachment {
  tempId: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
  dataUrl: string;
  sizeBytes: number;
}

interface BugModalProps {
  isOpen: boolean;
  theme: ThemeMode;
  columns: BoardColumn[];
  initialColumnId?: string;
  editingBug?: BugCard | null;
  onClose: () => void;
  onSave: (input: BugInput, pendingAttachments: PendingAttachment[]) => Promise<void>;
  onDelete?: (bugId: string) => Promise<void>;
  onPushToJira?: (bug: BugCard) => Promise<BugCard>;
  onPushToAdo?: (bug: BugCard) => Promise<BugCard>;
  onSyncSingleBugStatus?: (bug: BugCard) => Promise<void>;
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
    reader.onerror = () => reject(new Error('Falha ao ler arquivo selecionado.'));
    reader.readAsDataURL(file);
  });
}

export function BugModal({
  isOpen,
  theme,
  columns,
  initialColumnId,
  editingBug,
  onClose,
  onSave,
  onDelete,
  onPushToJira,
  onPushToAdo,
  onSyncSingleBugStatus,
}: BugModalProps) {
  const isLight = theme === 'light';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [columnId, setColumnId] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('Média');
  const [priority, setPriority] = useState<BugPriority>('P3 - Média');
  const [environment, setEnvironment] = useState('');
  const [buildVersion, setBuildVersion] = useState('');
  const [moduleName, setModuleName] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [stepsToReproduce, setStepsToReproduce] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [actualResult, setActualResult] = useState('');
  const [externalTicketUrl, setExternalTicketUrl] = useState('');

  const [savedAttachments, setSavedAttachments] = useState<AttachmentRecord[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [integrationLoading, setIntegrationLoading] = useState<'jira' | 'ado' | 'sync' | null>(
    null,
  );

  const [previewItem, setPreviewItem] = useState<{
    record: AttachmentRecord;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setPendingAttachments([]);

    if (editingBug) {
      setTitle(editingBug.title);
      setColumnId(editingBug.column_id);
      setSeverity(editingBug.severity);
      setPriority(editingBug.priority);
      setEnvironment(editingBug.environment);
      setBuildVersion(editingBug.build_version);
      setModuleName(editingBug.module);
      setTagsInput(editingBug.tags.join(', '));
      setStepsToReproduce(editingBug.steps_to_reproduce);
      setExpectedResult(editingBug.expected_result);
      setActualResult(editingBug.actual_result);
      setExternalTicketUrl(editingBug.external_ticket_url);

      void (async () => {
        const list = await listAttachmentsForParent('bug', editingBug.id);
        setSavedAttachments(list);
        const urls: Record<string, string> = {};
        for (const att of list) {
          try {
            urls[att.id] = await getAttachmentDataUrl(att);
          } catch {
            urls[att.id] = '';
          }
        }
        setAttachmentUrls(urls);
      })();
    } else {
      setTitle('');
      setColumnId(initialColumnId || columns[0]?.id || 'col-new');
      setSeverity('Média');
      setPriority('P3 - Média');
      setEnvironment('Homologação');
      setBuildVersion('');
      setModuleName('');
      setTagsInput('');
      setStepsToReproduce('');
      setExpectedResult('');
      setActualResult('');
      setExternalTicketUrl('');
      setSavedAttachments([]);
      setAttachmentUrls({});
    }
  }, [isOpen, editingBug, initialColumnId, columns]);

  if (!isOpen) return null;

  const handleFilesAdded = async (files: FileList | File[]) => {
    setErrorMsg(null);
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      const mimeType = file.type || 'application/octet-stream';
      if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
        setErrorMsg('Apenas imagens (prints) e vídeos são suportados como evidência.');
        continue;
      }

      const { base64, dataUrl } = await fileToBase64(file);
      const fileName =
        file.name && file.name !== 'image.png'
          ? file.name
          : `print-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;

      if (editingBug) {
        const record = await saveAttachmentForParent({
          parentType: 'bug',
          parentId: editingBug.id,
          fileName,
          mimeType,
          base64Data: base64,
        });
        setSavedAttachments((prev) => [...prev, record]);
        setAttachmentUrls((prev) => ({ ...prev, [record.id]: dataUrl }));
      } else {
        setPendingAttachments((prev) => [
          ...prev,
          {
            tempId: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fileName,
            mimeType,
            base64Data: base64,
            dataUrl,
            sizeBytes: file.size,
          },
        ]);
      }
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const mediaFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
        const file = item.getAsFile();
        if (file) {
          mediaFiles.push(file);
        }
      }
    }

    if (mediaFiles.length > 0) {
      e.preventDefault();
      await handleFilesAdded(mediaFiles);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFilesAdded(e.dataTransfer.files);
    }
  };

  const handleRemoveSavedAttachment = async (attId: string) => {
    await deleteAttachment(attId);
    setSavedAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const handleRemovePendingAttachment = (tempId: string) => {
    setPendingAttachments((prev) => prev.filter((p) => p.tempId !== tempId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Informe o título do bug.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      await onSave(
        {
          column_id: columnId || columns[0]?.id || 'col-new',
          title,
          severity,
          priority,
          environment,
          build_version: buildVersion,
          module: moduleName,
          tags,
          steps_to_reproduce: stepsToReproduce,
          expected_result: expectedResult,
          actual_result: actualResult,
          external_ticket_url: externalTicketUrl,
        },
        pendingAttachments,
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar bug.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass = `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
    isLight
      ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
      : 'bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-500'
  }`;

  const labelClass = `block text-xs font-semibold mb-1 ${
    isLight ? 'text-slate-700' : 'text-slate-300'
  }`;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label={editingBug ? 'Editar Bug' : 'Novo Bug'}
        onPaste={handlePaste}
      >
        <div
          className={`w-full max-w-4xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] ${
            isLight
              ? 'bg-white border-slate-200 text-slate-900'
              : 'bg-slate-900 border-slate-800 text-slate-100'
          }`}
        >
          {/* Modal Header */}
          <div
            className={`px-6 py-4 border-b flex items-center justify-between ${
              isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/50'
            }`}
          >
            <div>
              <h2 className="text-lg font-bold">
                {editingBug ? 'Editar Card de Bug' : 'Novo Card de Bug'}
              </h2>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Dica: pressione{' '}
                <kbd className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-mono">
                  Ctrl+V
                </kbd>{' '}
                em qualquer lugar desta janela para colar um print da área de transferência.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar modal"
              className={`p-1.5 rounded-lg transition-colors ${
                isLight ? 'text-slate-500 hover:bg-slate-200' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Modal Form Body */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
            {errorMsg && (
              <div className="rounded-lg bg-rose-500/15 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-400 font-medium">
                {errorMsg}
              </div>
            )}

            {editingBug && (
              <div
                className={`flex flex-wrap items-center gap-4 text-xs px-3.5 py-2 rounded-lg border ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  Criado em: {new Date(editingBug.created_at).toLocaleString('pt-BR')}
                </span>
                <span>•</span>
                <span>
                  Atualizado em: {new Date(editingBug.updated_at).toLocaleString('pt-BR')}
                </span>
                {editingBug.reopened_count > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-amber-400 font-semibold">
                      Reaberto {editingBug.reopened_count}x
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Title and Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="bug-title" className={labelClass}>
                  Título do Bug *
                </label>
                <input
                  id="bug-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Botão Finalizar Compra não responde ao usar cupom de desconto"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="bug-column" className={labelClass}>
                  Coluna (Status)
                </label>
                <select
                  id="bug-column"
                  value={columnId}
                  onChange={(e) => setColumnId(e.target.value)}
                  className={inputClass}
                >
                  {columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Severity, Priority, Environment, Build */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label htmlFor="bug-severity" className={labelClass}>
                  Severidade
                </label>
                <select
                  id="bug-severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as BugSeverity)}
                  className={inputClass}
                >
                  {SEVERITY_OPTIONS.map((sev) => (
                    <option key={sev} value={sev}>
                      {sev}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="bug-priority" className={labelClass}>
                  Prioridade
                </label>
                <select
                  id="bug-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as BugPriority)}
                  className={inputClass}
                >
                  {PRIORITY_OPTIONS.map((pri) => (
                    <option key={pri} value={pri}>
                      {pri}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="bug-environment" className={labelClass}>
                  Ambiente
                </label>
                <input
                  id="bug-environment"
                  type="text"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  placeholder="Ex.: Homologação, Staging, Prod"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="bug-build" className={labelClass}>
                  Versão / Build
                </label>
                <input
                  id="bug-build"
                  type="text"
                  value={buildVersion}
                  onChange={(e) => setBuildVersion(e.target.value)}
                  placeholder="Ex.: v2.4.1 / #892"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Module, Tags, External Ticket Link */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="bug-module" className={labelClass}>
                  Módulo / Feature
                </label>
                <input
                  id="bug-module"
                  type="text"
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  placeholder="Ex.: Checkout, Autenticação"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="bug-tags" className={labelClass}>
                  Tags (separadas por vírgula)
                </label>
                <input
                  id="bug-tags"
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="Ex.: regressão, pagamento, mobile"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="bug-external-link" className={labelClass}>
                  Link do Ticket Externo
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="bug-external-link"
                    type="text"
                    value={externalTicketUrl}
                    onChange={(e) => setExternalTicketUrl(e.target.value)}
                    placeholder="https://jira.../browse/QA-123"
                    className={inputClass}
                  />
                  {externalTicketUrl.trim() && (
                    <a
                      href={externalTicketUrl.trim()}
                      target="_blank"
                      rel="noreferrer"
                      title="Abrir ticket externo"
                      className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 shrink-0"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Phase 4: External Integrations Actions (Jira / Azure DevOps / Status Sync) */}
            {editingBug && (onPushToJira || onPushToAdo || onSyncSingleBugStatus) && (
              <div
                className={`rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-3 ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-700'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="text-xs font-bold flex items-center gap-2">
                    <span>Integração Externa (Jira / Azure DevOps)</span>
                    {editingBug.external_ticket_key && (
                      <span
                        data-testid="bug-modal-external-badge"
                        className="font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      >
                        {editingBug.external_provider === 'jira' ? 'Jira' : 'ADO'} •{' '}
                        {editingBug.external_ticket_key}
                        {editingBug.external_status ? ` (${editingBug.external_status})` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Envie este card (com prints anexados) ou consulte o status atual sem expor
                    credenciais ao front-end.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onPushToJira && (
                    <button
                      type="button"
                      data-testid="create-jira-issue-btn"
                      disabled={integrationLoading !== null}
                      onClick={async () => {
                        setErrorMsg(null);
                        setIntegrationLoading('jira');
                        try {
                          const updated = await onPushToJira(editingBug);
                          setExternalTicketUrl(updated.external_ticket_url);
                        } catch (err) {
                          setErrorMsg(err instanceof Error ? err.message : String(err));
                        } finally {
                          setIntegrationLoading(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {integrationLoading === 'jira' ? 'Enviando...' : 'Criar Issue no Jira'}
                    </button>
                  )}

                  {onPushToAdo && (
                    <button
                      type="button"
                      data-testid="create-ado-workitem-btn"
                      disabled={integrationLoading !== null}
                      onClick={async () => {
                        setErrorMsg(null);
                        setIntegrationLoading('ado');
                        try {
                          const updated = await onPushToAdo(editingBug);
                          setExternalTicketUrl(updated.external_ticket_url);
                        } catch (err) {
                          setErrorMsg(err instanceof Error ? err.message : String(err));
                        } finally {
                          setIntegrationLoading(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {integrationLoading === 'ado' ? 'Enviando...' : 'Criar Bug no Azure DevOps'}
                    </button>
                  )}

                  {editingBug.external_ticket_key && onSyncSingleBugStatus && (
                    <button
                      type="button"
                      data-testid="sync-single-bug-status-btn"
                      disabled={integrationLoading !== null}
                      onClick={async () => {
                        setErrorMsg(null);
                        setIntegrationLoading('sync');
                        try {
                          await onSyncSingleBugStatus(editingBug);
                        } catch (err) {
                          setErrorMsg(err instanceof Error ? err.message : String(err));
                        } finally {
                          setIntegrationLoading(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border border-indigo-500/30 disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${integrationLoading === 'sync' ? 'animate-spin' : ''}`}
                      />
                      Atualizar Status
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Steps to Reproduce, Expected & Actual Results */}
            <div className="space-y-4">
              <div>
                <label htmlFor="bug-steps" className={labelClass}>
                  Passos para Reproduzir
                </label>
                <textarea
                  id="bug-steps"
                  rows={3}
                  value={stepsToReproduce}
                  onChange={(e) => setStepsToReproduce(e.target.value)}
                  placeholder={
                    '1. Acessar a tela de checkout\n2. Inserir o cupom TESTE10\n3. Clicar em Finalizar Compra'
                  }
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="bug-expected" className={labelClass}>
                    Resultado Esperado
                  </label>
                  <textarea
                    id="bug-expected"
                    rows={3}
                    value={expectedResult}
                    onChange={(e) => setExpectedResult(e.target.value)}
                    placeholder="O pedido deve ser processado aplicando 10% de desconto."
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="bug-actual" className={labelClass}>
                    Resultado Obtido
                  </label>
                  <textarea
                    id="bug-actual"
                    rows={3}
                    value={actualResult}
                    onChange={(e) => setActualResult(e.target.value)}
                    placeholder="Erro 500 retornado na API e botão fica travado em carregamento."
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            {/* Attachments Section (Ctrl+V & Drag-and-Drop) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className={labelClass}>
                  Anexos e Evidências ({savedAttachments.length + pendingAttachments.length})
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Selecionar imagem ou vídeo</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      void handleFilesAdded(e.target.files);
                      e.target.value = '';
                    }
                  }}
                />
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={handleDrop}
                className={`rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
                  isDraggingOver
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : isLight
                      ? 'border-slate-300 bg-slate-50'
                      : 'border-slate-800 bg-slate-950/50'
                }`}
              >
                <div className="flex flex-col items-center justify-center gap-1.5 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-indigo-400">
                    <ClipboardPaste className="h-4 w-4" />
                    <span>Cole um print com Ctrl+V ou arraste prints e vídeos para cá</span>
                  </div>
                  <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    Os arquivos ficam salvos localmente na pasta de dados do QA Board.
                  </p>
                </div>

                {/* Thumbnails Grid */}
                {(savedAttachments.length > 0 || pendingAttachments.length > 0) && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-left">
                    {savedAttachments.map((att) => {
                      const url = attachmentUrls[att.id] || '';
                      const isVideo = att.mime_type.startsWith('video/');
                      return (
                        <div
                          key={att.id}
                          className={`group relative rounded-lg border overflow-hidden ${
                            isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
                          }`}
                        >
                          <div className="h-24 w-full bg-slate-950 flex items-center justify-center overflow-hidden">
                            {isVideo ? (
                              <div className="flex flex-col items-center gap-1 text-indigo-400">
                                <Film className="h-7 w-7" />
                                <span className="text-[10px]">Vídeo</span>
                              </div>
                            ) : url ? (
                              <img
                                src={url}
                                alt={att.file_name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-[10px] text-slate-500">Carregando...</span>
                            )}
                          </div>
                          <div className="p-2 flex items-center justify-between gap-1">
                            <span
                              className="text-[11px] truncate font-medium"
                              title={att.file_name}
                            >
                              {att.file_name}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {url && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewItem({ record: att, url })}
                                  title="Visualizar ampliado"
                                  className="p-1 rounded hover:bg-indigo-500/20 text-indigo-400"
                                >
                                  <Maximize2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleRemoveSavedAttachment(att.id)}
                                title="Excluir anexo"
                                className="p-1 rounded hover:bg-rose-500/20 text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {pendingAttachments.map((item) => {
                      const isVideo = item.mimeType.startsWith('video/');
                      const pseudoRecord: AttachmentRecord = {
                        id: item.tempId,
                        parent_type: 'bug',
                        parent_id: 'pending',
                        file_name: item.fileName,
                        mime_type: item.mimeType,
                        relative_path: '',
                        size_bytes: item.sizeBytes,
                        created_at: new Date().toISOString(),
                      };
                      return (
                        <div
                          key={item.tempId}
                          className={`group relative rounded-lg border overflow-hidden ${
                            isLight
                              ? 'border-indigo-200 bg-white'
                              : 'border-indigo-900/60 bg-slate-900'
                          }`}
                        >
                          <div className="h-24 w-full bg-slate-950 flex items-center justify-center overflow-hidden">
                            {isVideo ? (
                              <div className="flex flex-col items-center gap-1 text-indigo-400">
                                <Film className="h-7 w-7" />
                                <span className="text-[10px]">Vídeo (Novo)</span>
                              </div>
                            ) : (
                              <img
                                src={item.dataUrl}
                                alt={item.fileName}
                                className="h-full w-full object-cover"
                              />
                            )}
                          </div>
                          <div className="p-2 flex items-center justify-between gap-1">
                            <span
                              className="text-[11px] truncate font-medium"
                              title={item.fileName}
                            >
                              {item.fileName}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewItem({ record: pseudoRecord, url: item.dataUrl })
                                }
                                title="Visualizar ampliado"
                                className="p-1 rounded hover:bg-indigo-500/20 text-indigo-400"
                              >
                                <Maximize2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemovePendingAttachment(item.tempId)}
                                title="Remover anexo"
                                className="p-1 rounded hover:bg-rose-500/20 text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              className={`pt-4 border-t flex items-center justify-between gap-3 ${
                isLight ? 'border-slate-200' : 'border-slate-800'
              }`}
            >
              <div>
                {editingBug && onDelete && (
                  <button
                    type="button"
                    onClick={() => void onDelete(editingBug.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Excluir Bug</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    isLight
                      ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {isSaving ? 'Salvando...' : editingBug ? 'Salvar Alterações' : 'Criar Bug'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <AttachmentPreviewModal
        attachment={previewItem?.record ?? null}
        dataUrl={previewItem?.url ?? null}
        onClose={() => setPreviewItem(null)}
      />
    </>
  );
}
