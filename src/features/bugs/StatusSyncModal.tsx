import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { StatusSyncProposal, ThemeMode } from '../../types/models';

interface StatusSyncModalProps {
  isOpen: boolean;
  theme: ThemeMode;
  proposals: StatusSyncProposal[];
  onClose: () => void;
  onConfirm: (selectedProposals: StatusSyncProposal[]) => Promise<void>;
}

export const StatusSyncModal: React.FC<StatusSyncModalProps> = ({
  isOpen,
  theme,
  proposals,
  onClose,
  onConfirm,
}) => {
  const isLight = theme === 'light';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set(proposals.map((p) => p.bug_id)));
    }
  }, [isOpen, proposals]);

  if (!isOpen) return null;

  const toggleSelect = (bugId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bugId)) {
        next.delete(bugId);
      } else {
        next.add(bugId);
      }
      return next;
    });
  };

  const handleApply = async () => {
    const selected = proposals.filter((p) => selectedIds.has(p.bug_id));
    if (selected.length === 0) {
      onClose();
      return;
    }
    setIsApplying(true);
    try {
      await onConfirm(selected);
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Revisar Sincronização de Status Externos"
    >
      <div
        className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
          isLight
            ? 'bg-white border-slate-200 text-slate-900'
            : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        <div
          className={`px-6 py-4 border-b flex items-center justify-between ${
            isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/60'
          }`}
        >
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-indigo-500" />
              Revisar Alterações de Status Externos
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Confirme abaixo quais alterações de status e movimentos de coluna deseja aplicar no
              board.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar revisão de status"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {proposals.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-sm font-semibold">Tudo sincronizado!</p>
              <p className="text-xs text-slate-500">
                Nenhuma diferença de status ou coluna foi encontrada nos tickets externos.
              </p>
            </div>
          ) : (
            proposals.map((prop) => {
              const checked = selectedIds.has(prop.bug_id);
              return (
                <label
                  key={prop.bug_id}
                  data-testid={`sync-proposal-${prop.bug_id}`}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    checked
                      ? isLight
                        ? 'border-indigo-300 bg-indigo-50/50'
                        : 'border-indigo-500/40 bg-indigo-950/20'
                      : isLight
                        ? 'border-slate-200 bg-white opacity-60'
                        : 'border-slate-800 bg-slate-950/40 opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(prop.bug_id)}
                    className="mt-1 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="flex-1 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm">{prop.bug_title}</span>
                      <span className="font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-semibold">
                        {prop.provider === 'jira' ? 'Jira' : 'ADO'} • #{prop.ticket_key}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <span>Status externo:</span>
                        <span className="font-mono line-through">
                          {prop.previous_external_status}
                        </span>
                        <ArrowRight className="w-3 h-3 text-indigo-400" />
                        <span className="font-mono font-semibold text-emerald-500">
                          {prop.new_external_status}
                        </span>
                      </div>

                      {prop.will_move_column ? (
                        <div className="flex items-center gap-1.5">
                          <span>Coluna no Board:</span>
                          <span className="font-medium">{prop.current_column_name}</span>
                          <ArrowRight className="w-3 h-3 text-amber-400" />
                          <span className="font-bold text-amber-400">
                            {prop.proposed_column_name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] opacity-75">
                          (Mantém na coluna &ldquo;{prop.current_column_name}&rdquo;)
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div
          className={`px-6 py-4 border-t flex items-center justify-end gap-2.5 ${
            isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/60'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {proposals.length === 0 ? 'Fechar' : 'Cancelar'}
          </button>
          {proposals.length > 0 && (
            <button
              type="button"
              data-testid="confirm-status-sync-btn"
              disabled={isApplying || selectedIds.size === 0}
              onClick={() => void handleApply()}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 cursor-pointer"
            >
              {isApplying ? 'Aplicando...' : `Aplicar Alterações (${selectedIds.size})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
