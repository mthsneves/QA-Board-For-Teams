import React, { useState } from 'react';
import { Zap, X, ClipboardPaste, Keyboard, CheckCircle2 } from 'lucide-react';
import { BugSeverity, SEVERITY_OPTIONS, ThemeMode } from '../../types/models';
import {
  createBug,
  listColumns,
  saveAttachmentForParent,
  setQuickCaptureShortcut,
} from '../../db/database';

interface QuickCaptureModalProps {
  isOpen: boolean;
  theme: ThemeMode;
  currentShortcut: string;
  onShortcutUpdated: (newShortcut: string) => Promise<void>;
  onBugCreated: () => void;
  onClose: () => void;
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
    reader.onerror = () => reject(new Error('Falha ao ler print.'));
    reader.readAsDataURL(file);
  });
}

export function QuickCaptureModal({
  isOpen,
  theme,
  currentShortcut,
  onShortcutUpdated,
  onBugCreated,
  onClose,
}: QuickCaptureModalProps) {
  const isLight = theme === 'light';

  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('Alta');
  const [moduleName, setModuleName] = useState('');
  const [buildVersion, setBuildVersion] = useState('');
  const [actualResult, setActualResult] = useState('');
  const [pastedImages, setPastedImages] = useState<
    Array<{ fileName: string; mimeType: string; base64: string; dataUrl: string }>
  >([]);

  const [shortcutDraft, setShortcutDraft] = useState(currentShortcut);
  const [isEditingShortcut, setIsEditingShortcut] = useState(false);
  const [shortcutSavedMsg, setShortcutSavedMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const { base64, dataUrl } = await fileToBase64(file);
          setPastedImages((prev) => [
            ...prev,
            {
              fileName: `captura-rapida-${Date.now()}.png`,
              mimeType: file.type || 'image/png',
              base64,
              dataUrl,
            },
          ]);
        }
      }
    }
  };

  const handleSaveShortcut = async () => {
    const cleaned = shortcutDraft.trim() || 'CommandOrControl+Shift+B';
    await setQuickCaptureShortcut(cleaned);
    await onShortcutUpdated(cleaned);
    setIsEditingShortcut(false);
    setShortcutSavedMsg(`Atalho atualizado para ${cleaned}`);
    setTimeout(() => setShortcutSavedMsg(null), 3000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const cols = await listColumns();
    const created = await createBug({
      column_id: cols[0]?.id || 'col-new',
      title,
      severity,
      priority: severity === 'Crítica' ? 'P1 - Urgente' : 'P2 - Alta',
      environment: 'Homologação',
      build_version: buildVersion,
      module: moduleName,
      tags: ['captura-rápida'],
      steps_to_reproduce: '',
      expected_result: '',
      actual_result: actualResult,
      external_ticket_url: '',
    });

    for (const img of pastedImages) {
      await saveAttachmentForParent({
        parentType: 'bug',
        parentId: created.id,
        fileName: img.fileName,
        mimeType: img.mimeType,
        base64Data: img.base64,
      });
    }

    setTitle('');
    setModuleName('');
    setBuildVersion('');
    setActualResult('');
    setPastedImages([]);
    onBugCreated();
    onClose();
  };

  const inputClass = `w-full rounded-lg border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
    isLight
      ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
      : 'bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-500'
  }`;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Captura Rápida de Bug"
      onPaste={(e) => void handlePaste(e)}
    >
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
          isLight
            ? 'bg-white border-slate-200 text-slate-900'
            : 'bg-slate-900 border-slate-700 text-slate-100'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-indigo-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-300" />
            <h3 className="font-bold text-sm">Captura Rápida de Bug</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar captura rápida"
            className="p-1 rounded-lg hover:bg-indigo-500 text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Configurable Global Shortcut Bar */}
          <div
            className={`rounded-xl border px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2 ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-600'
                : 'bg-slate-950/60 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Keyboard className="h-3.5 w-3.5 text-indigo-400" />
              <span>Atalho global:</span>
              <code className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                {currentShortcut}
              </code>
            </div>

            {!isEditingShortcut ? (
              <button
                type="button"
                onClick={() => {
                  setShortcutDraft(currentShortcut);
                  setIsEditingShortcut(true);
                }}
                className="text-indigo-400 hover:underline font-medium"
              >
                Configurar atalho
              </button>
            ) : (
              <div className="flex items-center gap-1.5 w-full mt-1">
                <input
                  type="text"
                  aria-label="Novo atalho global"
                  value={shortcutDraft}
                  onChange={(e) => setShortcutDraft(e.target.value)}
                  placeholder="Ex.: CommandOrControl+Shift+B"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => void handleSaveShortcut()}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold shrink-0"
                >
                  Salvar Atalho
                </button>
              </div>
            )}
          </div>

          {shortcutSavedMsg && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{shortcutSavedMsg}</span>
            </div>
          )}

          {/* Quick Bug Form */}
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div>
              <label htmlFor="qc-title" className="block text-xs font-semibold mb-1">
                Título Rápido do Bug *
              </label>
              <input
                id="qc-title"
                type="text"
                required
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="O que falhou? Ex.: Modal de endereço fecha sozinho ao digitar CEP"
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label htmlFor="qc-severity" className="block text-xs font-semibold mb-1">
                  Severidade
                </label>
                <select
                  id="qc-severity"
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
                <label htmlFor="qc-module" className="block text-xs font-semibold mb-1">
                  Módulo
                </label>
                <input
                  id="qc-module"
                  type="text"
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  placeholder="Ex.: Cadastro"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="qc-build" className="block text-xs font-semibold mb-1">
                  Build
                </label>
                <input
                  id="qc-build"
                  type="text"
                  value={buildVersion}
                  onChange={(e) => setBuildVersion(e.target.value)}
                  placeholder="Ex.: v2.4.0"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label htmlFor="qc-actual" className="block text-xs font-semibold mb-1">
                Observação / Resultado Obtido
              </label>
              <textarea
                id="qc-actual"
                rows={3}
                value={actualResult}
                onChange={(e) => setActualResult(e.target.value)}
                placeholder="Anote rapidamente o erro ou cole um print com Ctrl+V..."
                className={inputClass}
              />
            </div>

            <div className="rounded-xl border border-dashed border-indigo-500/40 bg-indigo-500/5 p-2.5 text-xs flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-indigo-400">
                <ClipboardPaste className="h-3.5 w-3.5" />
                <span>Pressione Ctrl+V para colar print direto aqui</span>
              </span>
              <span className="font-semibold text-indigo-300">{pastedImages.length} print(s)</span>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-700 text-slate-400 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
              >
                Registrar Bug Agora
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
