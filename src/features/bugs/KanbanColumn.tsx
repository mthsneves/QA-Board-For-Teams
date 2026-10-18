import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Edit2, Trash2, Check, X } from 'lucide-react';
import { BoardColumn, BugCard, ThemeMode } from '../../types/models';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  column: BoardColumn;
  columnIndex: number;
  totalColumns: number;
  bugs: BugCard[];
  attachmentCounts: Record<string, number>;
  theme: ThemeMode;
  onAddBugToColumn: (columnId: string) => void;
  onEditBug: (bug: BugCard) => void;
  onDeleteBug: (bugId: string) => void;
  onMoveBugDirection: (bug: BugCard, direction: 'left' | 'right') => void;
  onRenameColumn: (columnId: string, newName: string) => Promise<void>;
  onDeleteColumn: (columnId: string) => Promise<void>;
}

export function KanbanColumn({
  column,
  columnIndex,
  totalColumns,
  bugs,
  attachmentCounts,
  theme,
  onAddBugToColumn,
  onEditBug,
  onDeleteBug,
  onMoveBugDirection,
  onRenameColumn,
  onDeleteColumn,
}: KanbanColumnProps) {
  const isLight = theme === 'light';
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: 'Column',
      column,
    },
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(column.name);

  const handleSaveName = async () => {
    if (nameDraft.trim() && nameDraft.trim() !== column.name) {
      await onRenameColumn(column.id, nameDraft.trim());
    }
    setIsEditingName(false);
  };

  return (
    <section
      ref={setNodeRef}
      aria-label={`Coluna ${column.name}`}
      data-testid={`kanban-col-${column.id}`}
      className={`w-80 shrink-0 rounded-2xl border flex flex-col max-h-full transition-colors ${
        isOver
          ? 'border-indigo-500 ring-2 ring-indigo-500/20'
          : isLight
            ? 'bg-slate-100/80 border-slate-200/90'
            : 'bg-slate-900/50 border-slate-800/90'
      }`}
    >
      {/* Column Header */}
      <div
        className={`px-3.5 py-3 border-b flex items-center justify-between gap-2 ${
          isLight ? 'border-slate-200/80' : 'border-slate-800/80'
        }`}
      >
        {isEditingName ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              aria-label="Novo nome da coluna"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveName();
                if (e.key === 'Escape') {
                  setNameDraft(column.name);
                  setIsEditingName(false);
                }
              }}
              className={`flex-1 rounded px-2 py-1 text-xs font-semibold border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-900'
                  : 'bg-slate-950 border-slate-700 text-slate-100'
              }`}
            />
            <button
              type="button"
              onClick={() => void handleSaveName()}
              aria-label="Salvar nome da coluna"
              className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setNameDraft(column.name);
                setIsEditingName(false);
              }}
              aria-label="Cancelar edição da coluna"
              className="p-1 rounded text-slate-400 hover:bg-slate-700/40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-bold text-xs uppercase tracking-wider truncate">{column.name}</h3>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                isLight ? 'bg-slate-200 text-slate-700' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {bugs.length}
            </span>
          </div>
        )}

        {!isEditingName && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onAddBugToColumn(column.id)}
              aria-label={`Adicionar bug em ${column.name}`}
              title={`Novo bug em ${column.name}`}
              className={`p-1 rounded transition-colors ${
                isLight
                  ? 'text-slate-500 hover:text-indigo-600 hover:bg-slate-200'
                  : 'text-slate-400 hover:text-indigo-400 hover:bg-slate-800'
              }`}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setNameDraft(column.name);
                setIsEditingName(true);
              }}
              aria-label={`Renomear coluna ${column.name}`}
              title="Renomear coluna"
              className={`p-1 rounded transition-colors ${
                isLight
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
            {totalColumns > 1 && bugs.length === 0 && (
              <button
                type="button"
                onClick={() => void onDeleteColumn(column.id)}
                aria-label={`Remover coluna ${column.name}`}
                title="Remover coluna vazia"
                className={`p-1 rounded transition-colors ${
                  isLight
                    ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-100'
                    : 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/40'
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cards Container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-[160px]">
        <SortableContext items={bugs.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {bugs.map((bug) => (
            <KanbanCard
              key={bug.id}
              bug={bug}
              theme={theme}
              attachmentCount={attachmentCounts[bug.id] || 0}
              canMoveLeft={columnIndex > 0}
              canMoveRight={columnIndex < totalColumns - 1}
              onEdit={onEditBug}
              onDelete={onDeleteBug}
              onMoveDirection={onMoveBugDirection}
            />
          ))}
        </SortableContext>

        {bugs.length === 0 && (
          <div
            className={`rounded-xl border border-dashed p-5 text-center text-xs ${
              isLight ? 'border-slate-300/80 text-slate-400' : 'border-slate-800/80 text-slate-500'
            }`}
          >
            Nenhum bug nesta coluna
          </div>
        )}
      </div>
    </section>
  );
}
