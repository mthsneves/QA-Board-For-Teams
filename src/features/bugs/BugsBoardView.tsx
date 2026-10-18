import { useCallback, useEffect, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  Plus,
  Columns3,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  BoardColumn,
  BugCard,
  BugFilters,
  BugInput,
  StatusSyncProposal,
  ThemeMode,
} from '../../types/models';
import {
  applyExternalStatusProposals,
  checkExternalStatusUpdates,
  createAdoWorkItemForBug,
  createBug,
  createColumn,
  createJiraIssueForBug,
  deleteBug,
  deleteColumn,
  exportBackupDialog,
  filterBugs,
  importBackupDialog,
  listAllAttachments,
  listBugs,
  listColumns,
  moveAndReorderBug,
  saveAttachmentForParent,
  updateBug,
  updateColumnName,
} from '../../db/database';
import { BugFiltersBar } from './BugFiltersBar';
import { KanbanColumn } from './KanbanColumn';
import { BugModal, PendingAttachment } from './BugModal';
import { StatusSyncModal } from './StatusSyncModal';

interface BugsBoardViewProps {
  theme: ThemeMode;
  onThemeRestored?: (theme: ThemeMode) => void;
}

const INITIAL_FILTERS: BugFilters = {
  search: '',
  tag: '',
  columnId: '',
  severity: '',
  module: '',
  buildVersion: '',
};

export function BugsBoardView({ theme, onThemeRestored }: BugsBoardViewProps) {
  const isLight = theme === 'light';
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [bugs, setBugs] = useState<BugCard[]>([]);
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<BugFilters>(INITIAL_FILTERS);

  const [isBugModalOpen, setIsBugModalOpen] = useState(false);
  const [modalInitialColumnId, setModalInitialColumnId] = useState<string | undefined>();
  const [editingBug, setEditingBug] = useState<BugCard | null>(null);
  const [bugPendingDelete, setBugPendingDelete] = useState<BugCard | null>(null);

  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');

  const [isSyncingStatuses, setIsSyncingStatuses] = useState(false);
  const [syncProposals, setSyncProposals] = useState<StatusSyncProposal[]>([]);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const showNotice = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  const reloadBoard = useCallback(async () => {
    const [cols, bugList, allAtts] = await Promise.all([
      listColumns(),
      listBugs(),
      listAllAttachments(),
    ]);
    setColumns(cols);
    setBugs(bugList);

    const counts: Record<string, number> = {};
    for (const att of allAtts) {
      if (att.parent_type === 'bug') {
        counts[att.parent_id] = (counts[att.parent_id] || 0) + 1;
      }
    }
    setAttachmentCounts(counts);
  }, []);

  useEffect(() => {
    void reloadBoard();
  }, [reloadBoard]);

  const handleOpenCreateBug = (columnId?: string) => {
    setEditingBug(null);
    setModalInitialColumnId(columnId || columns[0]?.id);
    setIsBugModalOpen(true);
  };

  const handleOpenEditBug = (bug: BugCard) => {
    setEditingBug(bug);
    setIsBugModalOpen(true);
  };

  const handleSaveBug = async (input: BugInput, pendingAttachments: PendingAttachment[]) => {
    if (editingBug) {
      await updateBug(editingBug.id, input);
      showNotice('success', 'Bug atualizado com sucesso.');
    } else {
      const created = await createBug(input);
      for (const item of pendingAttachments) {
        await saveAttachmentForParent({
          parentType: 'bug',
          parentId: created.id,
          fileName: item.fileName,
          mimeType: item.mimeType,
          base64Data: item.base64Data,
        });
      }
      showNotice('success', 'Novo bug registrado no board.');
    }
    await reloadBoard();
  };

  const handleRequestDeleteBug = async (bugId: string) => {
    const target = bugs.find((b) => b.id === bugId) || editingBug;
    if (target) {
      setBugPendingDelete(target);
    }
  };

  const handleConfirmDeleteBug = async () => {
    if (!bugPendingDelete) return;
    await deleteBug(bugPendingDelete.id);
    setBugPendingDelete(null);
    setIsBugModalOpen(false);
    setEditingBug(null);
    await reloadBoard();
    showNotice('success', 'Bug removido.');
  };

  const handleMoveBugDirection = async (bug: BugCard, direction: 'left' | 'right') => {
    const currentColIdx = columns.findIndex((c) => c.id === bug.column_id);
    if (currentColIdx < 0) return;

    const targetColIdx = direction === 'left' ? currentColIdx - 1 : currentColIdx + 1;
    const targetCol = columns[targetColIdx];
    if (!targetCol) return;

    const targetColBugIds = bugs
      .filter((b) => b.column_id === targetCol.id && b.id !== bug.id)
      .map((b) => b.id);
    targetColBugIds.push(bug.id);

    await moveAndReorderBug(bug.id, targetCol.id, targetColBugIds);
    await reloadBoard();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeBugId = String(active.id);
    const overId = String(over.id);
    if (activeBugId === overId) return;

    const activeBug = bugs.find((b) => b.id === activeBugId);
    if (!activeBug) return;

    // Check if dropped over a column directly or over another bug card
    const overColumn = columns.find((c) => c.id === overId);
    const overBug = bugs.find((b) => b.id === overId);

    const targetColumnId = overColumn
      ? overColumn.id
      : overBug
        ? overBug.column_id
        : activeBug.column_id;

    const targetBugs = bugs.filter((b) => b.column_id === targetColumnId);

    if (activeBug.column_id === targetColumnId) {
      // Reordering inside the same column
      const oldIdx = targetBugs.findIndex((b) => b.id === activeBugId);
      const newIdx = targetBugs.findIndex((b) => b.id === overId);
      if (oldIdx < 0 || newIdx < 0) return;

      const reordered = arrayMove(targetBugs, oldIdx, newIdx).map((b) => b.id);
      await moveAndReorderBug(activeBugId, targetColumnId, reordered);
      await reloadBoard();
    } else {
      // Moving across columns
      const withoutActive = targetBugs.filter((b) => b.id !== activeBugId).map((b) => b.id);
      if (overBug) {
        const overIdx = withoutActive.indexOf(overBug.id);
        if (overIdx >= 0) {
          withoutActive.splice(overIdx, 0, activeBugId);
        } else {
          withoutActive.push(activeBugId);
        }
      } else {
        withoutActive.push(activeBugId);
      }
      await moveAndReorderBug(activeBugId, targetColumnId, withoutActive);
      await reloadBoard();
    }
  };

  const handleCreateColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColumnName.trim()) return;
    try {
      await createColumn(newColumnName);
      setNewColumnName('');
      setIsAddingColumn(false);
      await reloadBoard();
      showNotice('success', 'Nova coluna adicionada ao board.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao criar coluna.');
    }
  };

  const handleRenameColumn = async (columnId: string, newName: string) => {
    try {
      await updateColumnName(columnId, newName);
      await reloadBoard();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao renomear coluna.');
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    try {
      await deleteColumn(columnId);
      await reloadBoard();
      showNotice('success', 'Coluna removida.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao remover coluna.');
    }
  };

  const handleExportBackup = async () => {
    try {
      const savedPath = await exportBackupDialog();
      if (savedPath) {
        showNotice('success', 'Backup completo exportado com sucesso!');
      }
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Falha ao exportar arquivo de backup.',
      );
    }
  };

  const handleImportBackup = async () => {
    try {
      const restored = await importBackupDialog();
      if (restored) {
        if (onThemeRestored) {
          onThemeRestored(restored.theme);
        }
        await reloadBoard();
        showNotice(
          'success',
          `Backup importado com sucesso (${restored.bugs.length} bug(s), ${restored.columns.length} coluna(s)).`,
        );
      }
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Falha ao importar arquivo de backup.',
      );
    }
  };

  const handlePushToJira = async (bug: BugCard): Promise<BugCard> => {
    const updated = await createJiraIssueForBug(bug);
    setEditingBug(updated);
    await reloadBoard();
    showNotice('success', `Issue ${updated.external_ticket_key} criada no Jira com sucesso!`);
    return updated;
  };

  const handlePushToAdo = async (bug: BugCard): Promise<BugCard> => {
    const updated = await createAdoWorkItemForBug(bug);
    setEditingBug(updated);
    await reloadBoard();
    showNotice('success', `Work Item #${updated.external_ticket_key} criado no Azure DevOps!`);
    return updated;
  };

  const handleCheckSyncForBugs = async (targetBugs: BugCard[]) => {
    const linked = targetBugs.filter((b) => b.external_provider && b.external_ticket_key);
    if (linked.length === 0) {
      showNotice(
        'error',
        'Nenhum card possui ticket externo (Jira ou Azure DevOps) vinculado para sincronizar.',
      );
      return;
    }

    setIsSyncingStatuses(true);
    try {
      const proposals = await checkExternalStatusUpdates(linked, columns);
      setSyncProposals(proposals);
      setIsSyncModalOpen(true);
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Falha ao consultar status externos.',
      );
    } finally {
      setIsSyncingStatuses(false);
    }
  };

  const handleConfirmSyncProposals = async (selected: StatusSyncProposal[]) => {
    await applyExternalStatusProposals(selected);
    await reloadBoard();
    if (editingBug) {
      const freshBugs = await listBugs();
      const refreshed = freshBugs.find((b) => b.id === editingBug.id) || null;
      setEditingBug(refreshed);
    }
    showNotice('success', `${selected.length} card(s) sincronizado(s) com o status externo.`);
  };

  const filteredBugs = filterBugs(bugs, filters);
  const linkedBugsCount = bugs.filter((b) => b.external_provider && b.external_ticket_key).length;

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Board Kanban de Bugs</h2>
          <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Arraste cards entre colunas, cole prints com Ctrl+V e filtre por severidade, build ou
            tag.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {linkedBugsCount > 0 && (
            <button
              type="button"
              data-testid="sync-all-statuses-btn"
              disabled={isSyncingStatuses}
              onClick={() => void handleCheckSyncForBugs(bugs)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                isLight
                  ? 'bg-white border-indigo-300 text-indigo-700 hover:bg-indigo-50'
                  : 'bg-slate-900 border-indigo-700/60 text-indigo-300 hover:bg-slate-800'
              }`}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-indigo-400 ${isSyncingStatuses ? 'animate-spin' : ''}`}
              />
              <span>Atualizar Status ({linkedBugsCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleExportBackup()}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              isLight
                ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Download className="h-3.5 w-3.5 text-indigo-400" />
            <span>Exportar Backup (.zip)</span>
          </button>

          <button
            type="button"
            onClick={() => void handleImportBackup()}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              isLight
                ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Upload className="h-3.5 w-3.5 text-emerald-400" />
            <span>Importar Backup (.zip)</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAddingColumn((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              isLight
                ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Columns3 className="h-3.5 w-3.5 text-amber-400" />
            <span>Nova Coluna</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenCreateBug()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Novo Bug</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
              : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* New Column Inline Form */}
      {isAddingColumn && (
        <form
          onSubmit={handleCreateColumn}
          className={`flex items-center gap-2 p-3 rounded-xl border ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900/70 border-slate-800'
          }`}
        >
          <input
            type="text"
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            placeholder="Nome da nova coluna (ex.: Homologação, Bloqueado)..."
            autoFocus
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              isLight
                ? 'bg-white border-slate-300 text-slate-900'
                : 'bg-slate-950 border-slate-700 text-slate-100'
            }`}
          />
          <button
            type="submit"
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
          >
            Adicionar Coluna
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAddingColumn(false);
              setNewColumnName('');
            }}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-800"
          >
            Cancelar
          </button>
        </form>
      )}

      {/* Search & Filters Bar */}
      <BugFiltersBar
        filters={filters}
        columns={columns}
        theme={theme}
        totalCount={bugs.length}
        filteredCount={filteredBugs.length}
        onChange={setFilters}
        onReset={() => setFilters(INITIAL_FILTERS)}
      />

      {/* Kanban Columns Horizontal Scroll */}
      <div className="flex-1 overflow-x-auto pb-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <div className="flex gap-4 h-full min-h-[420px]">
            {columns.map((col, idx) => {
              const colBugs = filteredBugs
                .filter((b) => b.column_id === col.id)
                .sort((a, b) => a.position - b.position);

              return (
                <KanbanColumn
                  key={col.id}
                  column={col}
                  columnIndex={idx}
                  totalColumns={columns.length}
                  bugs={colBugs}
                  attachmentCounts={attachmentCounts}
                  theme={theme}
                  onAddBugToColumn={(colId) => handleOpenCreateBug(colId)}
                  onEditBug={handleOpenEditBug}
                  onDeleteBug={(bugId) => void handleRequestDeleteBug(bugId)}
                  onMoveBugDirection={(bug, dir) => void handleMoveBugDirection(bug, dir)}
                  onRenameColumn={handleRenameColumn}
                  onDeleteColumn={handleDeleteColumn}
                />
              );
            })}
          </div>
        </DndContext>
      </div>

      {/* Create / Edit Bug Modal */}
      <BugModal
        isOpen={isBugModalOpen}
        theme={theme}
        columns={columns}
        initialColumnId={modalInitialColumnId}
        editingBug={editingBug}
        onClose={() => {
          setIsBugModalOpen(false);
          setEditingBug(null);
        }}
        onSave={handleSaveBug}
        onDelete={handleRequestDeleteBug}
        onPushToJira={handlePushToJira}
        onPushToAdo={handlePushToAdo}
        onSyncSingleBugStatus={async (bug) => {
          await handleCheckSyncForBugs([bug]);
        }}
      />

      {/* Delete Bug Confirmation Modal */}
      {bugPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exclusão de bug"
        >
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden p-6 space-y-4 ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold">Confirmar Exclusão</h3>
                <p
                  className={`text-xs leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-300'}`}
                >
                  Tem certeza que deseja excluir o card{' '}
                  <strong className="font-semibold">&ldquo;{bugPendingDelete.title}&rdquo;</strong>?
                  Esta ação removerá o card e seus anexos e não pode ser desfeita.
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setBugPendingDelete(null)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  isLight
                    ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                    : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="confirm-delete-bug-btn"
                onClick={() => void handleConfirmDeleteBug()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Sim, Excluir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Sync Preview & Confirmation Modal */}
      <StatusSyncModal
        isOpen={isSyncModalOpen}
        theme={theme}
        proposals={syncProposals}
        onClose={() => setIsSyncModalOpen(false)}
        onConfirm={handleConfirmSyncProposals}
      />
    </div>
  );
}
