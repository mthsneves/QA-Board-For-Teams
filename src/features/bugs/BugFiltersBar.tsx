import { Search, RotateCcw } from 'lucide-react';
import { BoardColumn, BugFilters, SEVERITY_OPTIONS, ThemeMode } from '../../types/models';

interface BugFiltersBarProps {
  filters: BugFilters;
  columns: BoardColumn[];
  theme: ThemeMode;
  totalCount: number;
  filteredCount: number;
  onChange: (next: BugFilters) => void;
  onReset: () => void;
}

export function BugFiltersBar({
  filters,
  columns,
  theme,
  totalCount,
  filteredCount,
  onChange,
  onReset,
}: BugFiltersBarProps) {
  const isLight = theme === 'light';
  const hasActiveFilters = Boolean(
    filters.search ||
    filters.tag ||
    filters.columnId ||
    filters.severity ||
    filters.module ||
    filters.buildVersion,
  );

  const inputClass = `rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
    isLight
      ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
      : 'bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500'
  }`;

  return (
    <div
      className={`rounded-xl border p-3.5 flex flex-wrap items-center gap-2.5 ${
        isLight ? 'bg-white border-slate-200 shadow-xs' : 'bg-slate-900/60 border-slate-800'
      }`}
    >
      {/* Text Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          aria-label="Buscar por texto"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Buscar por título, passos, resultado..."
          className={`${inputClass} w-full pl-8`}
        />
      </div>

      {/* Status (Column) Filter */}
      <select
        aria-label="Filtrar por status"
        value={filters.columnId}
        onChange={(e) => onChange({ ...filters, columnId: e.target.value })}
        className={inputClass}
      >
        <option value="">Todos os status</option>
        {columns.map((col) => (
          <option key={col.id} value={col.id}>
            {col.name}
          </option>
        ))}
      </select>

      {/* Severity Filter */}
      <select
        aria-label="Filtrar por severidade"
        value={filters.severity}
        onChange={(e) => onChange({ ...filters, severity: e.target.value })}
        className={inputClass}
      >
        <option value="">Todas as severidades</option>
        {SEVERITY_OPTIONS.map((sev) => (
          <option key={sev} value={sev}>
            {sev}
          </option>
        ))}
      </select>

      {/* Module Filter */}
      <input
        type="text"
        aria-label="Filtrar por módulo"
        value={filters.module}
        onChange={(e) => onChange({ ...filters, module: e.target.value })}
        placeholder="Módulo / Feature"
        className={`${inputClass} w-36`}
      />

      {/* Build Filter */}
      <input
        type="text"
        aria-label="Filtrar por build"
        value={filters.buildVersion}
        onChange={(e) => onChange({ ...filters, buildVersion: e.target.value })}
        placeholder="Versão / Build"
        className={`${inputClass} w-32`}
      />

      {/* Tag Filter */}
      <input
        type="text"
        aria-label="Filtrar por tag"
        value={filters.tag}
        onChange={(e) => onChange({ ...filters, tag: e.target.value })}
        placeholder="Tag"
        className={`${inputClass} w-28`}
      />

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-400 hover:bg-indigo-500/15 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Limpar filtros</span>
        </button>
      )}

      <span
        className={`ml-auto text-xs font-medium ${isLight ? 'text-slate-500' : 'text-slate-400'}`}
      >
        Exibindo {filteredCount} de {totalCount} bug(s)
      </span>
    </div>
  );
}
