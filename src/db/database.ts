import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { MIGRATIONS } from './migrations';
import {
  AttachmentRecord,
  BackupPayload,
  BoardColumn,
  BugCard,
  BugFilters,
  BugInput,
  BugPriority,
  BugSeverity,
  DEFAULT_BOARD_COLUMNS,
  ThemeMode,
} from '../types/models';

const DB_URL = 'sqlite:qaboard.db';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function createId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

// ============================================================================
// In-Memory Fallback Store (Used for Vitest and non-Tauri browser preview)
// ============================================================================
interface MemoryStore {
  columns: BoardColumn[];
  bugs: BugCard[];
  attachments: AttachmentRecord[];
  preferences: Record<string, string>;
}

function createInitialMemoryStore(): MemoryStore {
  const now = new Date().toISOString();
  return {
    columns: DEFAULT_BOARD_COLUMNS.map((col) => ({
      ...col,
      created_at: now,
    })),
    bugs: [],
    attachments: [],
    preferences: { theme: 'dark' },
  };
}

let memoryStore: MemoryStore = createInitialMemoryStore();

export function resetInMemoryStoreForTests(): void {
  memoryStore = createInitialMemoryStore();
}

// ============================================================================
// SQLite Connection & Migrations
// ============================================================================
let dbInstancePromise: Promise<Database> | null = null;

async function getSqliteDb(): Promise<Database> {
  if (!dbInstancePromise) {
    dbInstancePromise = (async () => {
      const db = await Database.load(DB_URL);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);

      const appliedRows = await db.select<Array<{ version: number }>>(
        'SELECT version FROM schema_migrations ORDER BY version ASC',
      );
      const appliedSet = new Set(appliedRows.map((r) => Number(r.version)));

      for (const migration of MIGRATIONS) {
        if (!appliedSet.has(migration.version)) {
          for (const stmt of migration.statements) {
            await db.execute(stmt);
          }
          await db.execute(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)',
            [migration.version, migration.name, new Date().toISOString()],
          );
        }
      }

      // Seed default columns if board_columns is empty
      const existingCols = await db.select<Array<{ count: number }>>(
        'SELECT COUNT(*) as count FROM board_columns',
      );
      const count = Number(existingCols[0]?.count ?? 0);
      if (count === 0) {
        const now = new Date().toISOString();
        for (const col of DEFAULT_BOARD_COLUMNS) {
          await db.execute(
            'INSERT INTO board_columns (id, name, position, is_done_column, created_at) VALUES ($1, $2, $3, $4, $5)',
            [col.id, col.name, col.position, col.is_done_column ? 1 : 0, now],
          );
        }
      }

      return db;
    })();
  }
  return dbInstancePromise;
}

// ============================================================================
// Preferences (Dark/Light Mode)
// ============================================================================
export async function getThemePreference(): Promise<ThemeMode> {
  if (!isTauriRuntime()) {
    return (memoryStore.preferences.theme as ThemeMode) || 'dark';
  }
  const db = await getSqliteDb();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM app_preferences WHERE key = $1',
    ['theme'],
  );
  const val = rows[0]?.value;
  return val === 'light' ? 'light' : 'dark';
}

export async function setThemePreference(theme: ThemeMode): Promise<void> {
  if (!isTauriRuntime()) {
    memoryStore.preferences.theme = theme;
    return;
  }
  const db = await getSqliteDb();
  await db.execute(
    'INSERT INTO app_preferences (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['theme', theme],
  );
}

// ============================================================================
// Board Columns CRUD & Reordering
// ============================================================================
interface RawColumnRow {
  id: string;
  name: string;
  position: number;
  is_done_column: number;
  created_at: string;
}

export async function listColumns(): Promise<BoardColumn[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.columns].sort((a, b) => a.position - b.position);
  }
  const db = await getSqliteDb();
  const rows = await db.select<RawColumnRow[]>(
    'SELECT id, name, position, is_done_column, created_at FROM board_columns ORDER BY position ASC',
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: Number(r.position),
    is_done_column: Boolean(r.is_done_column),
    created_at: r.created_at,
  }));
}

export async function createColumn(name: string): Promise<BoardColumn> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('O nome da coluna não pode ficar vazio.');
  }
  const cols = await listColumns();
  const nextPosition = cols.length > 0 ? Math.max(...cols.map((c) => c.position)) + 1 : 0;
  const newCol: BoardColumn = {
    id: createId('col'),
    name: trimmed,
    position: nextPosition,
    is_done_column: trimmed.toLowerCase() === 'fechado',
    created_at: new Date().toISOString(),
  };

  if (!isTauriRuntime()) {
    memoryStore.columns.push(newCol);
    return newCol;
  }

  const db = await getSqliteDb();
  await db.execute(
    'INSERT INTO board_columns (id, name, position, is_done_column, created_at) VALUES ($1, $2, $3, $4, $5)',
    [newCol.id, newCol.name, newCol.position, newCol.is_done_column ? 1 : 0, newCol.created_at],
  );
  return newCol;
}

export async function updateColumnName(columnId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('O nome da coluna não pode ficar vazio.');
  }
  if (!isTauriRuntime()) {
    const col = memoryStore.columns.find((c) => c.id === columnId);
    if (col) {
      col.name = trimmed;
    }
    return;
  }
  const db = await getSqliteDb();
  await db.execute('UPDATE board_columns SET name = $1 WHERE id = $2', [trimmed, columnId]);
}

export async function deleteColumn(columnId: string): Promise<void> {
  const cols = await listColumns();
  if (cols.length <= 1) {
    throw new Error('O board deve ter pelo menos uma coluna.');
  }
  const bugs = await listBugs();
  const hasBugs = bugs.some((b) => b.column_id === columnId);
  if (hasBugs) {
    throw new Error('Mova ou exclua os cards desta coluna antes de removê-la.');
  }

  if (!isTauriRuntime()) {
    memoryStore.columns = memoryStore.columns.filter((c) => c.id !== columnId);
    return;
  }
  const db = await getSqliteDb();
  await db.execute('DELETE FROM board_columns WHERE id = $1', [columnId]);
}

// ============================================================================
// Bugs CRUD, Ordering & Filtering
// ============================================================================
interface RawBugRow {
  id: string;
  column_id: string;
  position: number;
  title: string;
  severity: string;
  priority: string;
  environment: string;
  build_version: string;
  module: string;
  tags_json: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  external_ticket_url: string;
  external_ticket_key: string;
  external_provider: string;
  external_status: string;
  reopened_count: number;
  test_run_item_id: string | null;
  exploratory_session_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRawBug(row: RawBugRow): BugCard {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json || '[]');
    if (Array.isArray(parsed)) {
      tags = parsed.map((t) => String(t));
    }
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    column_id: row.column_id,
    position: Number(row.position),
    title: row.title,
    severity: (row.severity as BugSeverity) || 'Média',
    priority: (row.priority as BugPriority) || 'P3 - Média',
    environment: row.environment || '',
    build_version: row.build_version || '',
    module: row.module || '',
    tags,
    steps_to_reproduce: row.steps_to_reproduce || '',
    expected_result: row.expected_result || '',
    actual_result: row.actual_result || '',
    external_ticket_url: row.external_ticket_url || '',
    external_ticket_key: row.external_ticket_key || '',
    external_provider: (row.external_provider as '' | 'jira' | 'azure_devops') || '',
    external_status: row.external_status || '',
    reopened_count: Number(row.reopened_count || 0),
    test_run_item_id: row.test_run_item_id ?? null,
    exploratory_session_id: row.exploratory_session_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listBugs(): Promise<BugCard[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.bugs].sort((a, b) => a.position - b.position);
  }
  const db = await getSqliteDb();
  const rows = await db.select<RawBugRow[]>(
    'SELECT * FROM bugs ORDER BY position ASC, created_at DESC',
  );
  return rows.map(mapRawBug);
}

export async function createBug(input: BugInput): Promise<BugCard> {
  const trimmedTitle = input.title.trim();
  if (!trimmedTitle) {
    throw new Error('O título do bug é obrigatório.');
  }

  const allBugs = await listBugs();
  const colBugs = allBugs.filter((b) => b.column_id === input.column_id);
  const nextPosition = colBugs.length > 0 ? Math.max(...colBugs.map((b) => b.position)) + 1 : 0;
  const now = new Date().toISOString();

  const bug: BugCard = {
    id: createId('bug'),
    column_id: input.column_id,
    position: nextPosition,
    title: trimmedTitle,
    severity: input.severity,
    priority: input.priority,
    environment: input.environment.trim(),
    build_version: input.build_version.trim(),
    module: input.module.trim(),
    tags: input.tags.map((t) => t.trim()).filter(Boolean),
    steps_to_reproduce: input.steps_to_reproduce.trim(),
    expected_result: input.expected_result.trim(),
    actual_result: input.actual_result.trim(),
    external_ticket_url: input.external_ticket_url.trim(),
    external_ticket_key: input.external_ticket_key?.trim() || '',
    external_provider: input.external_provider || '',
    external_status: input.external_status?.trim() || '',
    reopened_count: 0,
    test_run_item_id: input.test_run_item_id ?? null,
    exploratory_session_id: input.exploratory_session_id ?? null,
    created_at: now,
    updated_at: now,
  };

  if (!isTauriRuntime()) {
    memoryStore.bugs.push(bug);
    return bug;
  }

  const db = await getSqliteDb();
  await db.execute(
    `INSERT INTO bugs (
      id, column_id, position, title, severity, priority, environment, build_version,
      module, tags_json, steps_to_reproduce, expected_result, actual_result,
      external_ticket_url, external_ticket_key, external_provider, external_status,
      reopened_count, test_run_item_id, exploratory_session_id, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13,
      $14, $15, $16, $17,
      $18, $19, $20, $21, $22
    )`,
    [
      bug.id,
      bug.column_id,
      bug.position,
      bug.title,
      bug.severity,
      bug.priority,
      bug.environment,
      bug.build_version,
      bug.module,
      JSON.stringify(bug.tags),
      bug.steps_to_reproduce,
      bug.expected_result,
      bug.actual_result,
      bug.external_ticket_url,
      bug.external_ticket_key,
      bug.external_provider,
      bug.external_status,
      bug.reopened_count,
      bug.test_run_item_id,
      bug.exploratory_session_id,
      bug.created_at,
      bug.updated_at,
    ],
  );

  return bug;
}

export async function updateBug(bugId: string, input: Partial<BugInput>): Promise<BugCard> {
  const allBugs = await listBugs();
  const existing = allBugs.find((b) => b.id === bugId);
  if (!existing) {
    throw new Error('Bug não encontrado.');
  }

  const cols = await listColumns();
  const oldCol = cols.find((c) => c.id === existing.column_id);
  const newColId = input.column_id ?? existing.column_id;
  const newCol = cols.find((c) => c.id === newColId);

  let reopenedCount = existing.reopened_count;
  if (oldCol?.is_done_column && newCol && !newCol.is_done_column) {
    reopenedCount += 1;
  }

  const now = new Date().toISOString();
  const updated: BugCard = {
    ...existing,
    column_id: newColId,
    title: input.title !== undefined ? input.title.trim() : existing.title,
    severity: input.severity ?? existing.severity,
    priority: input.priority ?? existing.priority,
    environment: input.environment !== undefined ? input.environment.trim() : existing.environment,
    build_version:
      input.build_version !== undefined ? input.build_version.trim() : existing.build_version,
    module: input.module !== undefined ? input.module.trim() : existing.module,
    tags:
      input.tags !== undefined ? input.tags.map((t) => t.trim()).filter(Boolean) : existing.tags,
    steps_to_reproduce:
      input.steps_to_reproduce !== undefined
        ? input.steps_to_reproduce.trim()
        : existing.steps_to_reproduce,
    expected_result:
      input.expected_result !== undefined ? input.expected_result.trim() : existing.expected_result,
    actual_result:
      input.actual_result !== undefined ? input.actual_result.trim() : existing.actual_result,
    external_ticket_url:
      input.external_ticket_url !== undefined
        ? input.external_ticket_url.trim()
        : existing.external_ticket_url,
    external_ticket_key:
      input.external_ticket_key !== undefined
        ? input.external_ticket_key.trim()
        : existing.external_ticket_key,
    external_provider:
      input.external_provider !== undefined ? input.external_provider : existing.external_provider,
    external_status:
      input.external_status !== undefined ? input.external_status.trim() : existing.external_status,
    reopened_count: reopenedCount,
    updated_at: now,
  };

  if (!updated.title) {
    throw new Error('O título do bug é obrigatório.');
  }

  if (!isTauriRuntime()) {
    const idx = memoryStore.bugs.findIndex((b) => b.id === bugId);
    if (idx >= 0) {
      memoryStore.bugs[idx] = updated;
    }
    return updated;
  }

  const db = await getSqliteDb();
  await db.execute(
    `UPDATE bugs SET
      column_id = $1,
      title = $2,
      severity = $3,
      priority = $4,
      environment = $5,
      build_version = $6,
      module = $7,
      tags_json = $8,
      steps_to_reproduce = $9,
      expected_result = $10,
      actual_result = $11,
      external_ticket_url = $12,
      external_ticket_key = $13,
      external_provider = $14,
      external_status = $15,
      reopened_count = $16,
      updated_at = $17
    WHERE id = $18`,
    [
      updated.column_id,
      updated.title,
      updated.severity,
      updated.priority,
      updated.environment,
      updated.build_version,
      updated.module,
      JSON.stringify(updated.tags),
      updated.steps_to_reproduce,
      updated.expected_result,
      updated.actual_result,
      updated.external_ticket_url,
      updated.external_ticket_key,
      updated.external_provider,
      updated.external_status,
      updated.reopened_count,
      updated.updated_at,
      updated.id,
    ],
  );

  return updated;
}

/**
 * Moves a bug to a target column and persists the new ordered positions of bugs in affected columns.
 */
export async function moveAndReorderBug(
  bugId: string,
  targetColumnId: string,
  orderedBugIdsInTargetColumn: string[],
): Promise<void> {
  const allBugs = await listBugs();
  const movingBug = allBugs.find((b) => b.id === bugId);
  if (!movingBug) return;

  const cols = await listColumns();
  const oldCol = cols.find((c) => c.id === movingBug.column_id);
  const newCol = cols.find((c) => c.id === targetColumnId);

  let reopenedCount = movingBug.reopened_count;
  if (
    movingBug.column_id !== targetColumnId &&
    oldCol?.is_done_column &&
    newCol &&
    !newCol.is_done_column
  ) {
    reopenedCount += 1;
  }

  const now = new Date().toISOString();

  if (!isTauriRuntime()) {
    movingBug.column_id = targetColumnId;
    movingBug.reopened_count = reopenedCount;
    movingBug.updated_at = now;
    orderedBugIdsInTargetColumn.forEach((id, index) => {
      const b = memoryStore.bugs.find((item) => item.id === id);
      if (b) {
        b.column_id = targetColumnId;
        b.position = index;
      }
    });
    return;
  }

  const db = await getSqliteDb();
  await db.execute(
    'UPDATE bugs SET column_id = $1, reopened_count = $2, updated_at = $3 WHERE id = $4',
    [targetColumnId, reopenedCount, now, bugId],
  );

  for (let i = 0; i < orderedBugIdsInTargetColumn.length; i++) {
    const id = orderedBugIdsInTargetColumn[i];
    await db.execute('UPDATE bugs SET column_id = $1, position = $2 WHERE id = $3', [
      targetColumnId,
      i,
      id,
    ]);
  }
}

export async function deleteBug(bugId: string): Promise<void> {
  const attachments = await listAttachmentsForParent('bug', bugId);
  for (const att of attachments) {
    await deleteAttachment(att.id);
  }

  if (!isTauriRuntime()) {
    memoryStore.bugs = memoryStore.bugs.filter((b) => b.id !== bugId);
    return;
  }
  const db = await getSqliteDb();
  await db.execute('DELETE FROM bugs WHERE id = $1', [bugId]);
}

export function filterBugs(bugs: BugCard[], filters: BugFilters): BugCard[] {
  const q = filters.search.trim().toLowerCase();
  const tagFilter = filters.tag.trim().toLowerCase();
  const modFilter = filters.module.trim().toLowerCase();
  const buildFilter = filters.buildVersion.trim().toLowerCase();

  return bugs.filter((bug) => {
    if (filters.columnId && bug.column_id !== filters.columnId) {
      return false;
    }
    if (filters.severity && bug.severity !== filters.severity) {
      return false;
    }
    if (modFilter && !bug.module.toLowerCase().includes(modFilter)) {
      return false;
    }
    if (buildFilter && !bug.build_version.toLowerCase().includes(buildFilter)) {
      return false;
    }
    if (tagFilter && !bug.tags.some((t) => t.toLowerCase().includes(tagFilter))) {
      return false;
    }
    if (q) {
      const searchable = [
        bug.title,
        bug.module,
        bug.environment,
        bug.build_version,
        bug.steps_to_reproduce,
        bug.expected_result,
        bug.actual_result,
        bug.external_ticket_key,
        ...bug.tags,
      ]
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

// ============================================================================
// Attachments Management (Ctrl+V Paste, Drag & Drop, File Input)
// ============================================================================
export async function listAllAttachments(): Promise<AttachmentRecord[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.attachments];
  }
  const db = await getSqliteDb();
  return db.select<AttachmentRecord[]>('SELECT * FROM attachments ORDER BY created_at ASC');
}

export async function listAttachmentsForParent(
  parentType: 'bug' | 'run_item' | 'exploratory',
  parentId: string,
): Promise<AttachmentRecord[]> {
  if (!isTauriRuntime()) {
    return memoryStore.attachments.filter(
      (a) => a.parent_type === parentType && a.parent_id === parentId,
    );
  }
  const db = await getSqliteDb();
  return db.select<AttachmentRecord[]>(
    'SELECT * FROM attachments WHERE parent_type = $1 AND parent_id = $2 ORDER BY created_at ASC',
    [parentType, parentId],
  );
}

export async function saveAttachmentForParent(params: {
  parentType: 'bug' | 'run_item' | 'exploratory';
  parentId: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
}): Promise<AttachmentRecord> {
  const id = createId('att');
  const now = new Date().toISOString();

  if (!isTauriRuntime()) {
    const sizeBytes = Math.floor((params.base64Data.length * 3) / 4);
    const record: AttachmentRecord = {
      id,
      parent_type: params.parentType,
      parent_id: params.parentId,
      file_name: params.fileName,
      mime_type: params.mimeType,
      relative_path: `attachments/${id}_${params.fileName}`,
      size_bytes: sizeBytes,
      created_at: now,
      inline_base64: params.base64Data,
    };
    memoryStore.attachments.push(record);
    return record;
  }

  const savedFile = await invoke<{ relative_path: string; size_bytes: number }>('save_attachment', {
    attachmentId: id,
    fileName: params.fileName,
    base64Data: params.base64Data,
  });

  const record: AttachmentRecord = {
    id,
    parent_type: params.parentType,
    parent_id: params.parentId,
    file_name: params.fileName,
    mime_type: params.mimeType,
    relative_path: savedFile.relative_path,
    size_bytes: savedFile.size_bytes,
    created_at: now,
  };

  const db = await getSqliteDb();
  await db.execute(
    `INSERT INTO attachments (
      id, parent_type, parent_id, file_name, mime_type, relative_path, size_bytes, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.parent_type,
      record.parent_id,
      record.file_name,
      record.mime_type,
      record.relative_path,
      record.size_bytes,
      record.created_at,
    ],
  );

  return record;
}

export async function getAttachmentDataUrl(att: AttachmentRecord): Promise<string> {
  if (!isTauriRuntime()) {
    const b64 = att.inline_base64 || '';
    return `data:${att.mime_type};base64,${b64}`;
  }
  const loaded = await invoke<{ base64_data: string; mime_type: string }>('read_attachment', {
    relativePath: att.relative_path,
    mimeType: att.mime_type,
  });
  return `data:${loaded.mime_type};base64,${loaded.base64_data}`;
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  if (!isTauriRuntime()) {
    memoryStore.attachments = memoryStore.attachments.filter((a) => a.id !== attachmentId);
    return;
  }

  const db = await getSqliteDb();
  const rows = await db.select<AttachmentRecord[]>('SELECT * FROM attachments WHERE id = $1', [
    attachmentId,
  ]);
  const target = rows[0];
  if (target) {
    try {
      await invoke('delete_attachment', { relativePath: target.relative_path });
    } catch {
      // Ignore if file was already removed from disk
    }
    await db.execute('DELETE FROM attachments WHERE id = $1', [attachmentId]);
  }
}

// ============================================================================
// Backup Export & Import (.zip with JSON + Attachments + Validation)
// ============================================================================
export function validateBackupPayload(data: unknown): BackupPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Formato de backup inválido: objeto raiz ausente.');
  }
  const candidate = data as Partial<BackupPayload>;
  if (typeof candidate.version !== 'number' || candidate.version < 1 || candidate.version > 10) {
    throw new Error('Versão do arquivo de backup inválida ou incompatível.');
  }
  if (!Array.isArray(candidate.columns) || candidate.columns.length === 0) {
    throw new Error('O backup precisa conter pelo menos uma coluna válida.');
  }
  for (const col of candidate.columns) {
    if (!col || typeof col.id !== 'string' || typeof col.name !== 'string') {
      throw new Error('Coluna inválida encontrada no arquivo de backup.');
    }
  }
  if (!Array.isArray(candidate.bugs)) {
    throw new Error('Lista de bugs ausente ou inválida no arquivo de backup.');
  }
  for (const bug of candidate.bugs) {
    if (
      !bug ||
      typeof bug.id !== 'string' ||
      typeof bug.title !== 'string' ||
      typeof bug.column_id !== 'string'
    ) {
      throw new Error('Card de bug inválido encontrado no arquivo de backup.');
    }
  }
  if (!Array.isArray(candidate.attachments)) {
    throw new Error('Lista de anexos ausente ou inválida no arquivo de backup.');
  }

  return {
    version: candidate.version,
    exported_at: candidate.exported_at || new Date().toISOString(),
    theme: candidate.theme === 'light' ? 'light' : 'dark',
    columns: candidate.columns,
    bugs: candidate.bugs,
    attachments: candidate.attachments,
  };
}

export async function buildBackupPayload(): Promise<BackupPayload> {
  const [theme, columns, bugs, attachments] = await Promise.all([
    getThemePreference(),
    listColumns(),
    listBugs(),
    listAllAttachments(),
  ]);

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    theme,
    columns,
    bugs,
    attachments,
  };
}

export async function restoreFromBackupPayload(payload: BackupPayload): Promise<void> {
  const validated = validateBackupPayload(payload);

  if (!isTauriRuntime()) {
    memoryStore = {
      columns: validated.columns.map((c) => ({ ...c })),
      bugs: validated.bugs.map((b) => ({ ...b, tags: [...(b.tags || [])] })),
      attachments: validated.attachments.map((a) => ({ ...a })),
      preferences: { theme: validated.theme },
    };
    return;
  }

  const db = await getSqliteDb();
  await db.execute('DELETE FROM attachments');
  await db.execute('DELETE FROM bugs');
  await db.execute('DELETE FROM board_columns');

  for (const col of validated.columns) {
    await db.execute(
      'INSERT INTO board_columns (id, name, position, is_done_column, created_at) VALUES ($1, $2, $3, $4, $5)',
      [col.id, col.name, col.position, col.is_done_column ? 1 : 0, col.created_at],
    );
  }

  for (const bug of validated.bugs) {
    await db.execute(
      `INSERT INTO bugs (
        id, column_id, position, title, severity, priority, environment, build_version,
        module, tags_json, steps_to_reproduce, expected_result, actual_result,
        external_ticket_url, external_ticket_key, external_provider, external_status,
        reopened_count, test_run_item_id, exploratory_session_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20, $21, $22
      )`,
      [
        bug.id,
        bug.column_id,
        bug.position,
        bug.title,
        bug.severity,
        bug.priority,
        bug.environment || '',
        bug.build_version || '',
        bug.module || '',
        JSON.stringify(bug.tags || []),
        bug.steps_to_reproduce || '',
        bug.expected_result || '',
        bug.actual_result || '',
        bug.external_ticket_url || '',
        bug.external_ticket_key || '',
        bug.external_provider || '',
        bug.external_status || '',
        bug.reopened_count || 0,
        bug.test_run_item_id ?? null,
        bug.exploratory_session_id ?? null,
        bug.created_at,
        bug.updated_at,
      ],
    );
  }

  for (const att of validated.attachments) {
    await db.execute(
      `INSERT INTO attachments (
        id, parent_type, parent_id, file_name, mime_type, relative_path, size_bytes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        att.id,
        att.parent_type,
        att.parent_id,
        att.file_name,
        att.mime_type,
        att.relative_path,
        att.size_bytes,
        att.created_at,
      ],
    );
  }

  await setThemePreference(validated.theme);
}

export async function exportBackupDialog(): Promise<string | null> {
  const payload = await buildBackupPayload();
  const jsonStr = JSON.stringify(payload, null, 2);

  if (!isTauriRuntime()) {
    return jsonStr;
  }

  const defaultName = `qaboard-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  const targetPath = await save({
    title: 'Exportar Backup do QA Board (.zip)',
    defaultPath: defaultName,
    filters: [{ name: 'Pacote de Backup QA Board (.zip)', extensions: ['zip'] }],
  });

  if (!targetPath) {
    return null;
  }

  await invoke('export_backup_zip', {
    destinationPath: targetPath,
    backupJson: jsonStr,
  });

  return targetPath;
}

export async function importBackupDialog(): Promise<BackupPayload | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const sourcePath = await open({
    title: 'Importar Backup do QA Board (.zip)',
    multiple: false,
    directory: false,
    filters: [{ name: 'Pacote de Backup QA Board (.zip)', extensions: ['zip'] }],
  });

  if (!sourcePath || typeof sourcePath !== 'string') {
    return null;
  }

  const jsonStr = await invoke<string>('import_backup_zip', {
    sourcePath,
  });

  const parsed = JSON.parse(jsonStr);
  const validated = validateBackupPayload(parsed);
  await restoreFromBackupPayload(validated);
  return validated;
}
