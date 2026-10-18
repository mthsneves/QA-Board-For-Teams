import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Paperclip,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit3,
  Layers,
  Tag,
} from 'lucide-react';
import { BugCard, BugSeverity, ThemeMode } from '../../types/models';

interface KanbanCardProps {
  bug: BugCard;
  theme: ThemeMode;
  attachmentCount: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onEdit: (bug: BugCard) => void;
  onDelete: (bugId: string) => void;
  onMoveDirection: (bug: BugCard, direction: 'left' | 'right') => void;
}

const SEVERITY_BADGE_STYLES: Record<BugSeverity, string> = {
  Crítica: 'bg-rose-500/20 text-rose-400 border-rose-500/40',
  Alta: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  Média: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  Baixa: 'bg-sky-500/20 text-sky-400 border-sky-500/40',
};

export function KanbanCard({
  bug,
  theme,
  attachmentCount,
  canMoveLeft,
  canMoveRight,
  onEdit,
  onDelete,
  onMoveDirection,
}: KanbanCardProps) {
  const isLight = theme === 'light';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: bug.id,
    data: {
      type: 'Bug',
      bug,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`bug-card-${bug.id}`}
      className={`group rounded-xl border p-3.5 shadow-sm transition-all ${
        isDragging ? 'opacity-50 ring-2 ring-indigo-500' : ''
      } ${
        isLight
          ? 'bg-white border-slate-200 hover:border-indigo-300 text-slate-900'
          : 'bg-slate-900/90 border-slate-800 hover:border-slate-700 text-slate-100'
      }`}
    >
      {/* Top Row: Severity, Priority & Drag Handle */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              SEVERITY_BADGE_STYLES[bug.severity] || SEVERITY_BADGE_STYLES['Média']
            }`}
          >
            {bug.severity}
          </span>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {bug.priority}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onEdit(bug)}
            aria-label={`Editar ${bug.title}`}
            title="Editar bug"
            className={`p-1 rounded transition-colors ${
              isLight
                ? 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'
                : 'text-slate-500 hover:text-indigo-400 hover:bg-slate-800'
            }`}
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(bug.id)}
            aria-label={`Excluir ${bug.title}`}
            title="Excluir bug"
            className={`p-1 rounded transition-colors ${
              isLight
                ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                : 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/40'
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Arrastar ${bug.title}`}
            title="Arrastar card"
            className={`p-1 rounded cursor-grab active:cursor-grabbing ${
              isLight ? 'text-slate-400 hover:bg-slate-100' : 'text-slate-500 hover:bg-slate-800'
            }`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Bug Title */}
      <button
        type="button"
        onClick={() => onEdit(bug)}
        className="text-left w-full font-semibold text-sm leading-snug hover:text-indigo-400 transition-colors mb-2 line-clamp-2"
      >
        {bug.title}
      </button>

      {/* Module, Build, Environment */}
      {(bug.module || bug.build_version || bug.environment) && (
        <div
          className={`flex flex-wrap items-center gap-1.5 text-[11px] mb-2 ${
            isLight ? 'text-slate-600' : 'text-slate-400'
          }`}
        >
          {bug.module && (
            <span className="inline-flex items-center gap-1 font-medium">
              <Layers className="h-3 w-3 text-indigo-400" />
              {bug.module}
            </span>
          )}
          {bug.build_version && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                isLight ? 'bg-slate-100 text-slate-700' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {bug.build_version}
            </span>
          )}
          {bug.environment && <span className="text-[10px] opacity-80">({bug.environment})</span>}
        </div>
      )}

      {/* Tags */}
      {bug.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {bug.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
            >
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer: Attachments, External Ticket, Date & Quick Column Move */}
      <div
        className={`pt-2 border-t flex items-center justify-between text-[11px] ${
          isLight ? 'border-slate-100 text-slate-500' : 'border-slate-800/80 text-slate-400'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-indigo-400 font-medium"
              title={`${attachmentCount} anexo(s)`}
            >
              <Paperclip className="h-3 w-3" />
              {attachmentCount}
            </span>
          )}
          {bug.external_ticket_url && (
            <a
              href={bug.external_ticket_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
              title="Abrir ticket externo"
            >
              <ExternalLink className="h-3 w-3" />
              <span>{bug.external_ticket_key || 'Ticket'}</span>
            </a>
          )}
          <span className="text-[10px] opacity-75">
            {new Date(bug.updated_at).toLocaleDateString('pt-BR')}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canMoveLeft}
            onClick={() => onMoveDirection(bug, 'left')}
            aria-label={`Mover ${bug.title} para coluna anterior`}
            title="Mover para coluna anterior"
            className={`p-1 rounded disabled:opacity-25 ${
              isLight ? 'hover:bg-slate-100 text-slate-600' : 'hover:bg-slate-800 text-slate-300'
            }`}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!canMoveRight}
            onClick={() => onMoveDirection(bug, 'right')}
            aria-label={`Mover ${bug.title} para próxima coluna`}
            title="Mover para próxima coluna"
            className={`p-1 rounded disabled:opacity-25 ${
              isLight ? 'hover:bg-slate-100 text-slate-600' : 'hover:bg-slate-800 text-slate-300'
            }`}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
