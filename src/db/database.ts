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
  ChecklistCategory,
  ChecklistInput,
  ChecklistTemplate,
  DEFAULT_BOARD_COLUMNS,
  DEFAULT_INTEGRATION_SETTINGS,
  DEFAULT_STATUS_MAPPINGS,
  ExploratorySession,
  ExploratorySessionInput,
  ExternalTicketResult,
  IntegrationSecretKey,
  IntegrationSecretStatus,
  IntegrationSettings,
  SnippetCategory,
  SnippetInput,
  SnippetItem,
  StatusSyncProposal,
  TestCase,
  TestCaseInput,
  TestRun,
  TestRunInput,
  TestRunItem,
  TestRunItemStatus,
  ThemeMode,
} from '../types/models';
import {
  formatTestRunMarkdownReport,
  generateTestRunPdfBytes,
} from '../features/reports/productivityUtils';

const DB_URL = 'sqlite:qaboard.db';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function createId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export const DEFAULT_CHECKLISTS_SEED: Array<
  Pick<ChecklistTemplate, 'id' | 'name' | 'category' | 'description'>
> = [
  {
    id: 'chk-smoke',
    name: 'Checklist Smoke Test',
    category: 'Smoke',
    description: 'Validação rápida dos fluxos críticos logo após o deploy da build.',
  },
  {
    id: 'chk-regression',
    name: 'Suíte de Regressão Principal',
    category: 'Regressão',
    description: 'Bateria completa de regressão nos módulos centrais do sistema.',
  },
  {
    id: 'chk-prerelease',
    name: 'Checklist Pré-Release',
    category: 'Pré-Release',
    description:
      'Verificações finais de sanidade, integrações e fluxos ponta a ponta antes de produção.',
  },
];

export const DEFAULT_SNIPPETS_SEED: Array<
  Pick<SnippetItem, 'id' | 'title' | 'category' | 'content'>
> = [
  {
    id: 'snip-json-checkout',
    title: 'Payload JSON - Criação de Pedido (Checkout)',
    category: 'Payload JSON',
    content: JSON.stringify(
      {
        customer_id: 'usr_98412',
        payment_method: 'pix',
        items: [{ sku: 'PROD-001', quantity: 2, unit_price: 149.9 }],
        coupon_code: 'QA10OFF',
      },
      null,
      2,
    ),
  },
  {
    id: 'snip-sql-orders',
    title: 'Query SQL - Consultar Últimos Pedidos por Status',
    category: 'Query SQL',
    content:
      "SELECT id, customer_id, status, total_amount, created_at\nFROM orders\nWHERE status IN ('PENDING', 'FAILED')\nORDER BY created_at DESC\nLIMIT 25;",
  },
  {
    id: 'snip-curl-auth',
    title: 'cURL - Autenticação OAuth / Token de Homologação',
    category: 'Script / cURL',
    content:
      'curl -X POST "https://api-hml.exemplo.local/v1/auth/token" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"grant_type":"client_credentials","scope":"qa:read qa:write"}\'',
  },
];

// ============================================================================
// In-Memory Fallback Store (Used for Vitest and non-Tauri browser preview)
// ============================================================================
interface MemoryStore {
  columns: BoardColumn[];
  bugs: BugCard[];
  attachments: AttachmentRecord[];
  testCases: TestCase[];
  checklists: ChecklistTemplate[];
  testRuns: TestRun[];
  testRunItems: TestRunItem[];
  exploratorySessions: ExploratorySession[];
  snippets: SnippetItem[];
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
    testCases: [],
    checklists: DEFAULT_CHECKLISTS_SEED.map((chk) => ({
      ...chk,
      test_case_ids: [],
      created_at: now,
      updated_at: now,
    })),
    testRuns: [],
    testRunItems: [],
    exploratorySessions: [],
    snippets: DEFAULT_SNIPPETS_SEED.map((s) => ({
      ...s,
      created_at: now,
      updated_at: now,
    })),
    preferences: {
      theme: 'dark',
      quick_capture_shortcut: 'CommandOrControl+Shift+B',
    },
  };
}

let memoryStore: MemoryStore = createInitialMemoryStore();

export function resetInMemoryStoreForTests(): void {
  memoryStore = createInitialMemoryStore();
  resetIntegrationMockStateForTests();
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
      const colCount = Number(existingCols[0]?.count ?? 0);
      if (colCount === 0) {
        const now = new Date().toISOString();
        for (const col of DEFAULT_BOARD_COLUMNS) {
          await db.execute(
            'INSERT INTO board_columns (id, name, position, is_done_column, created_at) VALUES ($1, $2, $3, $4, $5)',
            [col.id, col.name, col.position, col.is_done_column ? 1 : 0, now],
          );
        }
      }

      // Seed default reusable checklists if checklists is empty
      const existingChecklists = await db.select<Array<{ count: number }>>(
        'SELECT COUNT(*) as count FROM checklists',
      );
      const chkCount = Number(existingChecklists[0]?.count ?? 0);
      if (chkCount === 0) {
        const now = new Date().toISOString();
        for (const chk of DEFAULT_CHECKLISTS_SEED) {
          await db.execute(
            'INSERT INTO checklists (id, name, category, description, test_case_ids_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [chk.id, chk.name, chk.category, chk.description, '[]', now, now],
          );
        }
      }

      // Seed default snippets if snippets is empty
      const existingSnippets = await db.select<Array<{ count: number }>>(
        'SELECT COUNT(*) as count FROM snippets',
      );
      const snipCount = Number(existingSnippets[0]?.count ?? 0);
      if (snipCount === 0) {
        const now = new Date().toISOString();
        for (const s of DEFAULT_SNIPPETS_SEED) {
          await db.execute(
            'INSERT INTO snippets (id, title, category, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
            [s.id, s.title, s.category, s.content, now, now],
          );
        }
      }

      return db;
    })();
  }
  return dbInstancePromise;
}

// ============================================================================
// Preferences (Dark/Light Mode & Global Quick Capture Shortcut)
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

export async function getQuickCaptureShortcut(): Promise<string> {
  if (!isTauriRuntime()) {
    return memoryStore.preferences.quick_capture_shortcut || 'CommandOrControl+Shift+B';
  }
  const db = await getSqliteDb();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM app_preferences WHERE key = $1',
    ['quick_capture_shortcut'],
  );
  return rows[0]?.value || 'CommandOrControl+Shift+B';
}

export async function setQuickCaptureShortcut(shortcut: string): Promise<void> {
  const cleaned = shortcut.trim() || 'CommandOrControl+Shift+B';
  if (!isTauriRuntime()) {
    memoryStore.preferences.quick_capture_shortcut = cleaned;
    return;
  }
  const db = await getSqliteDb();
  await db.execute(
    'INSERT INTO app_preferences (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['quick_capture_shortcut', cleaned],
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

function parseJsonArray(jsonStr: string): string[] {
  try {
    const parsed = JSON.parse(jsonStr || '[]');
    if (Array.isArray(parsed)) {
      return parsed.map((t) => String(t));
    }
  } catch {
    // fallback
  }
  return [];
}

function mapRawBug(row: RawBugRow): BugCard {
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
    tags: parseJsonArray(row.tags_json),
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
// Phase 2: Test Cases Library CRUD
// ============================================================================
interface RawTestCaseRow {
  id: string;
  title: string;
  module: string;
  tags_json: string;
  preconditions: string;
  steps: string;
  expected_result: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

function mapRawTestCase(row: RawTestCaseRow): TestCase {
  return {
    id: row.id,
    title: row.title,
    module: row.module || '',
    tags: parseJsonArray(row.tags_json),
    preconditions: row.preconditions || '',
    steps: row.steps || '',
    expected_result: row.expected_result || '',
    priority: (row.priority as BugPriority) || 'P3 - Média',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listTestCases(): Promise<TestCase[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.testCases].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const db = await getSqliteDb();
  const rows = await db.select<RawTestCaseRow[]>(
    'SELECT * FROM test_cases ORDER BY created_at DESC',
  );
  return rows.map(mapRawTestCase);
}

export async function createTestCase(input: TestCaseInput): Promise<TestCase> {
  const title = input.title.trim();
  if (!title) {
    throw new Error('O título do caso de teste é obrigatório.');
  }
  const now = new Date().toISOString();
  const tc: TestCase = {
    id: createId('tc'),
    title,
    module: input.module.trim(),
    tags: input.tags.map((t) => t.trim()).filter(Boolean),
    preconditions: input.preconditions.trim(),
    steps: input.steps.trim(),
    expected_result: input.expected_result.trim(),
    priority: input.priority,
    created_at: now,
    updated_at: now,
  };

  if (!isTauriRuntime()) {
    memoryStore.testCases.push(tc);
    return tc;
  }

  const db = await getSqliteDb();
  await db.execute(
    `INSERT INTO test_cases (
      id, title, module, tags_json, preconditions, steps, expected_result, priority, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      tc.id,
      tc.title,
      tc.module,
      JSON.stringify(tc.tags),
      tc.preconditions,
      tc.steps,
      tc.expected_result,
      tc.priority,
      tc.created_at,
      tc.updated_at,
    ],
  );
  return tc;
}

export async function updateTestCase(
  testCaseId: string,
  input: Partial<TestCaseInput>,
): Promise<TestCase> {
  const all = await listTestCases();
  const existing = all.find((c) => c.id === testCaseId);
  if (!existing) {
    throw new Error('Caso de teste não encontrado.');
  }
  const now = new Date().toISOString();
  const updated: TestCase = {
    ...existing,
    title: input.title !== undefined ? input.title.trim() : existing.title,
    module: input.module !== undefined ? input.module.trim() : existing.module,
    tags:
      input.tags !== undefined ? input.tags.map((t) => t.trim()).filter(Boolean) : existing.tags,
    preconditions:
      input.preconditions !== undefined ? input.preconditions.trim() : existing.preconditions,
    steps: input.steps !== undefined ? input.steps.trim() : existing.steps,
    expected_result:
      input.expected_result !== undefined ? input.expected_result.trim() : existing.expected_result,
    priority: input.priority ?? existing.priority,
    updated_at: now,
  };

  if (!updated.title) {
    throw new Error('O título do caso de teste é obrigatório.');
  }

  if (!isTauriRuntime()) {
    const idx = memoryStore.testCases.findIndex((c) => c.id === testCaseId);
    if (idx >= 0) {
      memoryStore.testCases[idx] = updated;
    }
    return updated;
  }

  const db = await getSqliteDb();
  await db.execute(
    `UPDATE test_cases SET
      title = $1, module = $2, tags_json = $3, preconditions = $4,
      steps = $5, expected_result = $6, priority = $7, updated_at = $8
    WHERE id = $9`,
    [
      updated.title,
      updated.module,
      JSON.stringify(updated.tags),
      updated.preconditions,
      updated.steps,
      updated.expected_result,
      updated.priority,
      updated.updated_at,
      updated.id,
    ],
  );
  return updated;
}

export async function deleteTestCase(testCaseId: string): Promise<void> {
  if (!isTauriRuntime()) {
    memoryStore.testCases = memoryStore.testCases.filter((c) => c.id !== testCaseId);
    memoryStore.checklists = memoryStore.checklists.map((chk) => ({
      ...chk,
      test_case_ids: chk.test_case_ids.filter((id) => id !== testCaseId),
    }));
    return;
  }
  const db = await getSqliteDb();
  await db.execute('DELETE FROM test_cases WHERE id = $1', [testCaseId]);
}

// ============================================================================
// Phase 2: Reusable Checklists / Templates (Smoke, Regressão, Pré-Release)
// ============================================================================
interface RawChecklistRow {
  id: string;
  name: string;
  category: string;
  description: string;
  test_case_ids_json: string;
  created_at: string;
  updated_at: string;
}

function mapRawChecklist(row: RawChecklistRow): ChecklistTemplate {
  return {
    id: row.id,
    name: row.name,
    category: (row.category as ChecklistCategory) || 'Smoke',
    description: row.description || '',
    test_case_ids: parseJsonArray(row.test_case_ids_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listChecklists(): Promise<ChecklistTemplate[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.checklists];
  }
  const db = await getSqliteDb();
  const rows = await db.select<RawChecklistRow[]>(
    'SELECT * FROM checklists ORDER BY created_at ASC',
  );
  return rows.map(mapRawChecklist);
}

export async function createChecklist(input: ChecklistInput): Promise<ChecklistTemplate> {
  const name = input.name.trim();
  if (!name) {
    throw new Error('O nome do checklist é obrigatório.');
  }
  const now = new Date().toISOString();
  const chk: ChecklistTemplate = {
    id: createId('chk'),
    name,
    category: input.category,
    description: input.description.trim(),
    test_case_ids: [...new Set(input.test_case_ids)],
    created_at: now,
    updated_at: now,
  };

  if (!isTauriRuntime()) {
    memoryStore.checklists.push(chk);
    return chk;
  }

  const db = await getSqliteDb();
  await db.execute(
    `INSERT INTO checklists (
      id, name, category, description, test_case_ids_json, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      chk.id,
      chk.name,
      chk.category,
      chk.description,
      JSON.stringify(chk.test_case_ids),
      chk.created_at,
      chk.updated_at,
    ],
  );
  return chk;
}

export async function updateChecklist(
  checklistId: string,
  input: Partial<ChecklistInput>,
): Promise<ChecklistTemplate> {
  const all = await listChecklists();
  const existing = all.find((c) => c.id === checklistId);
  if (!existing) {
    throw new Error('Checklist não encontrado.');
  }
  const now = new Date().toISOString();
  const updated: ChecklistTemplate = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() : existing.name,
    category: input.category ?? existing.category,
    description: input.description !== undefined ? input.description.trim() : existing.description,
    test_case_ids:
      input.test_case_ids !== undefined
        ? [...new Set(input.test_case_ids)]
        : existing.test_case_ids,
    updated_at: now,
  };

  if (!updated.name) {
    throw new Error('O nome do checklist é obrigatório.');
  }

  if (!isTauriRuntime()) {
    const idx = memoryStore.checklists.findIndex((c) => c.id === checklistId);
    if (idx >= 0) {
      memoryStore.checklists[idx] = updated;
    }
    return updated;
  }

  const db = await getSqliteDb();
  await db.execute(
    `UPDATE checklists SET
      name = $1, category = $2, description = $3, test_case_ids_json = $4, updated_at = $5
    WHERE id = $6`,
    [
      updated.name,
      updated.category,
      updated.description,
      JSON.stringify(updated.test_case_ids),
      updated.updated_at,
      updated.id,
    ],
  );
  return updated;
}

export async function deleteChecklist(checklistId: string): Promise<void> {
  if (!isTauriRuntime()) {
    memoryStore.checklists = memoryStore.checklists.filter((c) => c.id !== checklistId);
    return;
  }
  const db = await getSqliteDb();
  await db.execute('DELETE FROM checklists WHERE id = $1', [checklistId]);
}

// ============================================================================
// Phase 2: Test Runs & Test Run Items + Generate Bug from Failure
// ============================================================================
export async function listTestRuns(): Promise<TestRun[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.testRuns].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const db = await getSqliteDb();
  return db.select<TestRun[]>('SELECT * FROM test_runs ORDER BY created_at DESC');
}

export async function listTestRunItems(runId: string): Promise<TestRunItem[]> {
  if (!isTauriRuntime()) {
    return memoryStore.testRunItems.filter((item) => item.run_id === runId);
  }
  const db = await getSqliteDb();
  return db.select<TestRunItem[]>(
    'SELECT * FROM test_run_items WHERE run_id = $1 ORDER BY id ASC',
    [runId],
  );
}

export async function listAllTestRunItems(): Promise<TestRunItem[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.testRunItems];
  }
  const db = await getSqliteDb();
  return db.select<TestRunItem[]>('SELECT * FROM test_run_items ORDER BY id ASC');
}

export async function createTestRun(input: TestRunInput): Promise<TestRun> {
  const name = input.name.trim();
  if (!name) {
    throw new Error('O nome da execução (Test Run) é obrigatório.');
  }
  if (input.test_case_ids.length === 0) {
    throw new Error('Selecione pelo menos um caso de teste para criar a execução.');
  }

  const allCases = await listTestCases();
  const selectedCases = input.test_case_ids
    .map((id) => allCases.find((tc) => tc.id === id))
    .filter((tc): tc is TestCase => Boolean(tc));

  if (selectedCases.length === 0) {
    throw new Error('Nenhum caso de teste válido encontrado para esta execução.');
  }

  const now = new Date().toISOString();
  const run: TestRun = {
    id: createId('run'),
    name,
    build_version: input.build_version.trim(),
    environment: input.environment.trim(),
    checklist_id: input.checklist_id ?? null,
    created_at: now,
    updated_at: now,
  };

  const runItems: TestRunItem[] = selectedCases.map((tc, index) => ({
    id: `${createId('runitem')}-${index}`,
    run_id: run.id,
    test_case_id: tc.id,
    title: tc.title,
    module: tc.module,
    priority: tc.priority,
    preconditions: tc.preconditions,
    steps: tc.steps,
    expected_result: tc.expected_result,
    status: 'Pendente',
    notes: '',
    created_bug_id: null,
    executed_at: null,
  }));

  if (!isTauriRuntime()) {
    memoryStore.testRuns.push(run);
    memoryStore.testRunItems.push(...runItems);
    return run;
  }

  const db = await getSqliteDb();
  await db.execute(
    `INSERT INTO test_runs (
      id, name, build_version, environment, checklist_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      run.id,
      run.name,
      run.build_version,
      run.environment,
      run.checklist_id,
      run.created_at,
      run.updated_at,
    ],
  );

  for (const item of runItems) {
    await db.execute(
      `INSERT INTO test_run_items (
        id, run_id, test_case_id, title, module, priority, preconditions,
        steps, expected_result, status, notes, created_bug_id, executed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        item.id,
        item.run_id,
        item.test_case_id,
        item.title,
        item.module,
        item.priority,
        item.preconditions,
        item.steps,
        item.expected_result,
        item.status,
        item.notes,
        item.created_bug_id,
        item.executed_at,
      ],
    );
  }

  return run;
}

export async function updateTestRunItem(
  itemId: string,
  updates: {
    status?: TestRunItemStatus;
    notes?: string;
    created_bug_id?: string | null;
  },
): Promise<TestRunItem> {
  const allItems = await listAllTestRunItems();
  const existing = allItems.find((i) => i.id === itemId);
  if (!existing) {
    throw new Error('Item da execução não encontrado.');
  }

  const now = new Date().toISOString();
  const updated: TestRunItem = {
    ...existing,
    status: updates.status ?? existing.status,
    notes: updates.notes !== undefined ? updates.notes : existing.notes,
    created_bug_id:
      updates.created_bug_id !== undefined ? updates.created_bug_id : existing.created_bug_id,
    executed_at: updates.status && updates.status !== 'Pendente' ? now : existing.executed_at,
  };

  if (!isTauriRuntime()) {
    const idx = memoryStore.testRunItems.findIndex((i) => i.id === itemId);
    if (idx >= 0) {
      memoryStore.testRunItems[idx] = updated;
    }
    const run = memoryStore.testRuns.find((r) => r.id === existing.run_id);
    if (run) {
      run.updated_at = now;
    }
    return updated;
  }

  const db = await getSqliteDb();
  await db.execute(
    `UPDATE test_run_items SET
      status = $1, notes = $2, created_bug_id = $3, executed_at = $4
    WHERE id = $5`,
    [updated.status, updated.notes, updated.created_bug_id, updated.executed_at, updated.id],
  );
  await db.execute('UPDATE test_runs SET updated_at = $1 WHERE id = $2', [now, existing.run_id]);
  return updated;
}

export async function deleteTestRun(runId: string): Promise<void> {
  const items = await listTestRunItems(runId);
  for (const item of items) {
    const atts = await listAttachmentsForParent('run_item', item.id);
    for (const att of atts) {
      await deleteAttachment(att.id);
    }
  }

  if (!isTauriRuntime()) {
    memoryStore.testRunItems = memoryStore.testRunItems.filter((i) => i.run_id !== runId);
    memoryStore.testRuns = memoryStore.testRuns.filter((r) => r.id !== runId);
    return;
  }

  const db = await getSqliteDb();
  await db.execute('DELETE FROM test_run_items WHERE run_id = $1', [runId]);
  await db.execute('DELETE FROM test_runs WHERE id = $1', [runId]);
}

export async function generateBugFromRunItem(
  run: TestRun,
  item: TestRunItem,
  overrideSeverity?: BugSeverity,
): Promise<BugCard> {
  const cols = await listColumns();
  const firstColId = cols[0]?.id || 'col-new';

  const severityMap: Record<BugPriority, BugSeverity> = {
    'P1 - Urgente': 'Crítica',
    'P2 - Alta': 'Alta',
    'P3 - Média': 'Média',
    'P4 - Baixa': 'Baixa',
  };

  const createdBug = await createBug({
    column_id: firstColId,
    title: `[Falha em Execução] ${item.title}`,
    severity: overrideSeverity || severityMap[item.priority] || 'Alta',
    priority: item.priority,
    environment: run.environment,
    build_version: run.build_version,
    module: item.module,
    tags: ['test-run', run.name],
    steps_to_reproduce: item.preconditions
      ? `Pré-condições:\n${item.preconditions}\n\nPassos:\n${item.steps}`
      : item.steps,
    expected_result: item.expected_result,
    actual_result: item.notes.trim() || `Caso de teste falhou durante a execução "${run.name}".`,
    external_ticket_url: '',
    test_run_item_id: item.id,
  });

  const itemAtts = await listAttachmentsForParent('run_item', item.id);
  for (const att of itemAtts) {
    try {
      const dataUrl = await getAttachmentDataUrl(att);
      const commaIdx = dataUrl.indexOf(',');
      const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      await saveAttachmentForParent({
        parentType: 'bug',
        parentId: createdBug.id,
        fileName: att.file_name,
        mimeType: att.mime_type,
        base64Data: b64,
      });
    } catch {
      // Ignore attachment copy failure
    }
  }

  await updateTestRunItem(item.id, { created_bug_id: createdBug.id });
  return createdBug;
}

// ============================================================================
// Phase 2: Exploratory Testing Sessions
// ============================================================================
export async function listExploratorySessions(): Promise<ExploratorySession[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.exploratorySessions].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }
  const db = await getSqliteDb();
  return db.select<ExploratorySession[]>(
    'SELECT * FROM exploratory_sessions ORDER BY created_at DESC',
  );
}

export async function createExploratorySession(
  input: ExploratorySessionInput,
): Promise<ExploratorySession> {
  const charter = input.charter.trim();
  if (!charter) {
    throw new Error('A missão (charter) da sessão exploratória é obrigatória.');
  }
  const now = new Date().toISOString();
  const session: ExploratorySession = {
    id: createId('exp'),
    charter,
    environment: input.environment.trim(),
    build_version: input.build_version.trim(),
    module: input.module.trim(),
    notes: input.notes.trim(),
    duration_seconds: input.duration_seconds ?? 0,
    created_at: now,
    updated_at: now,
  };

  if (!isTauriRuntime()) {
    memoryStore.exploratorySessions.push(session);
    return session;
  }

  const db = await getSqliteDb();
  await db.execute(
    `INSERT INTO exploratory_sessions (
      id, charter, environment, build_version, module, notes, duration_seconds, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      session.id,
      session.charter,
      session.environment,
      session.build_version,
      session.module,
      session.notes,
      session.duration_seconds,
      session.created_at,
      session.updated_at,
    ],
  );
  return session;
}

export async function updateExploratorySession(
  sessionId: string,
  input: Partial<ExploratorySessionInput>,
): Promise<ExploratorySession> {
  const all = await listExploratorySessions();
  const existing = all.find((s) => s.id === sessionId);
  if (!existing) {
    throw new Error('Sessão exploratória não encontrada.');
  }
  const now = new Date().toISOString();
  const updated: ExploratorySession = {
    ...existing,
    charter: input.charter !== undefined ? input.charter.trim() : existing.charter,
    environment: input.environment !== undefined ? input.environment.trim() : existing.environment,
    build_version:
      input.build_version !== undefined ? input.build_version.trim() : existing.build_version,
    module: input.module !== undefined ? input.module.trim() : existing.module,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    duration_seconds:
      input.duration_seconds !== undefined ? input.duration_seconds : existing.duration_seconds,
    updated_at: now,
  };

  if (!isTauriRuntime()) {
    const idx = memoryStore.exploratorySessions.findIndex((s) => s.id === sessionId);
    if (idx >= 0) {
      memoryStore.exploratorySessions[idx] = updated;
    }
    return updated;
  }

  const db = await getSqliteDb();
  await db.execute(
    `UPDATE exploratory_sessions SET
      charter = $1, environment = $2, build_version = $3, module = $4,
      notes = $5, duration_seconds = $6, updated_at = $7
    WHERE id = $8`,
    [
      updated.charter,
      updated.environment,
      updated.build_version,
      updated.module,
      updated.notes,
      updated.duration_seconds,
      updated.updated_at,
      updated.id,
    ],
  );
  return updated;
}

export async function deleteExploratorySession(sessionId: string): Promise<void> {
  if (!isTauriRuntime()) {
    memoryStore.exploratorySessions = memoryStore.exploratorySessions.filter(
      (s) => s.id !== sessionId,
    );
    return;
  }
  const db = await getSqliteDb();
  await db.execute('DELETE FROM exploratory_sessions WHERE id = $1', [sessionId]);
}

// ============================================================================
// Phase 3: Snippets & Test Data Library + Test Run Report Export (MD / PDF)
// ============================================================================
export async function listSnippets(): Promise<SnippetItem[]> {
  if (!isTauriRuntime()) {
    return [...memoryStore.snippets];
  }
  const db = await getSqliteDb();
  const rows = await db.select<SnippetItem[]>('SELECT * FROM snippets ORDER BY created_at DESC');
  return rows.map((r) => ({
    ...r,
    category: (r.category as SnippetCategory) || 'Payload JSON',
  }));
}

export async function createSnippet(input: SnippetInput): Promise<SnippetItem> {
  const title = input.title.trim();
  if (!title) {
    throw new Error('O título do snippet é obrigatório.');
  }
  const now = new Date().toISOString();
  const item: SnippetItem = {
    id: createId('snip'),
    title,
    category: input.category,
    content: input.content,
    created_at: now,
    updated_at: now,
  };

  if (!isTauriRuntime()) {
    memoryStore.snippets.unshift(item);
    return item;
  }

  const db = await getSqliteDb();
  await db.execute(
    'INSERT INTO snippets (id, title, category, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [item.id, item.title, item.category, item.content, item.created_at, item.updated_at],
  );
  return item;
}

export async function deleteSnippet(snippetId: string): Promise<void> {
  if (!isTauriRuntime()) {
    memoryStore.snippets = memoryStore.snippets.filter((s) => s.id !== snippetId);
    return;
  }
  const db = await getSqliteDb();
  await db.execute('DELETE FROM snippets WHERE id = $1', [snippetId]);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function exportTestRunReportDialog(
  run: TestRun,
  items: TestRunItem[],
  format: 'md' | 'pdf',
): Promise<string | null> {
  const safeSlug =
    run.name
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-|-$/g, '') || 'test-run';

  if (format === 'md') {
    const mdContent = formatTestRunMarkdownReport(run, items);
    if (!isTauriRuntime()) {
      return mdContent;
    }
    const targetPath = await save({
      title: 'Exportar Relatório de Execução (Markdown)',
      defaultPath: `relatorio-${safeSlug}.md`,
      filters: [{ name: 'Markdown (.md)', extensions: ['md'] }],
    });
    if (!targetPath) return null;

    const bytes = new TextEncoder().encode(mdContent);
    await invoke('save_export_file', {
      destinationPath: targetPath,
      bytesBase64: uint8ArrayToBase64(bytes),
    });
    return targetPath;
  }

  // format === 'pdf'
  const pdfBytes = generateTestRunPdfBytes(run, items);
  if (!isTauriRuntime()) {
    return new TextDecoder().decode(pdfBytes);
  }
  const targetPath = await save({
    title: 'Exportar Relatório de Execução (PDF)',
    defaultPath: `relatorio-${safeSlug}.pdf`,
    filters: [{ name: 'Documento PDF (.pdf)', extensions: ['pdf'] }],
  });
  if (!targetPath) return null;

  await invoke('save_export_file', {
    destinationPath: targetPath,
    bytesBase64: uint8ArrayToBase64(pdfBytes),
  });
  return targetPath;
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
    test_cases: Array.isArray(candidate.test_cases) ? candidate.test_cases : [],
    checklists: Array.isArray(candidate.checklists) ? candidate.checklists : [],
    test_runs: Array.isArray(candidate.test_runs) ? candidate.test_runs : [],
    test_run_items: Array.isArray(candidate.test_run_items) ? candidate.test_run_items : [],
    exploratory_sessions: Array.isArray(candidate.exploratory_sessions)
      ? candidate.exploratory_sessions
      : [],
    snippets: Array.isArray(candidate.snippets) ? candidate.snippets : [],
  };
}

export async function buildBackupPayload(): Promise<BackupPayload> {
  const [
    theme,
    columns,
    bugs,
    attachments,
    test_cases,
    checklists,
    test_runs,
    test_run_items,
    exploratory_sessions,
    snippets,
  ] = await Promise.all([
    getThemePreference(),
    listColumns(),
    listBugs(),
    listAllAttachments(),
    listTestCases(),
    listChecklists(),
    listTestRuns(),
    listAllTestRunItems(),
    listExploratorySessions(),
    listSnippets(),
  ]);

  return {
    version: 3,
    exported_at: new Date().toISOString(),
    theme,
    columns,
    bugs,
    attachments,
    test_cases,
    checklists,
    test_runs,
    test_run_items,
    exploratory_sessions,
    snippets,
  };
}

export async function restoreFromBackupPayload(payload: BackupPayload): Promise<void> {
  const validated = validateBackupPayload(payload);

  if (!isTauriRuntime()) {
    memoryStore = {
      columns: validated.columns.map((c) => ({ ...c })),
      bugs: validated.bugs.map((b) => ({ ...b, tags: [...(b.tags || [])] })),
      attachments: validated.attachments.map((a) => ({ ...a })),
      testCases: (validated.test_cases || []).map((tc) => ({
        ...tc,
        tags: [...(tc.tags || [])],
      })),
      checklists:
        validated.checklists && validated.checklists.length > 0
          ? validated.checklists.map((chk) => ({
              ...chk,
              test_case_ids: [...(chk.test_case_ids || [])],
            }))
          : DEFAULT_CHECKLISTS_SEED.map((chk) => ({
              ...chk,
              test_case_ids: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })),
      testRuns: (validated.test_runs || []).map((r) => ({ ...r })),
      testRunItems: (validated.test_run_items || []).map((i) => ({ ...i })),
      exploratorySessions: (validated.exploratory_sessions || []).map((s) => ({ ...s })),
      snippets:
        validated.snippets && validated.snippets.length > 0
          ? validated.snippets.map((s) => ({ ...s }))
          : DEFAULT_SNIPPETS_SEED.map((s) => ({
              ...s,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })),
      preferences: {
        theme: validated.theme,
        quick_capture_shortcut:
          memoryStore.preferences.quick_capture_shortcut || 'CommandOrControl+Shift+B',
      },
    };
    return;
  }

  const db = await getSqliteDb();
  await db.execute('DELETE FROM attachments');
  await db.execute('DELETE FROM snippets');
  await db.execute('DELETE FROM test_run_items');
  await db.execute('DELETE FROM test_runs');
  await db.execute('DELETE FROM checklists');
  await db.execute('DELETE FROM test_cases');
  await db.execute('DELETE FROM exploratory_sessions');
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

  for (const tc of validated.test_cases || []) {
    await db.execute(
      `INSERT INTO test_cases (
        id, title, module, tags_json, preconditions, steps, expected_result, priority, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        tc.id,
        tc.title,
        tc.module || '',
        JSON.stringify(tc.tags || []),
        tc.preconditions || '',
        tc.steps || '',
        tc.expected_result || '',
        tc.priority,
        tc.created_at,
        tc.updated_at,
      ],
    );
  }

  for (const chk of validated.checklists || []) {
    await db.execute(
      `INSERT INTO checklists (
        id, name, category, description, test_case_ids_json, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        chk.id,
        chk.name,
        chk.category,
        chk.description || '',
        JSON.stringify(chk.test_case_ids || []),
        chk.created_at,
        chk.updated_at,
      ],
    );
  }

  for (const run of validated.test_runs || []) {
    await db.execute(
      `INSERT INTO test_runs (
        id, name, build_version, environment, checklist_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        run.id,
        run.name,
        run.build_version || '',
        run.environment || '',
        run.checklist_id ?? null,
        run.created_at,
        run.updated_at,
      ],
    );
  }

  for (const item of validated.test_run_items || []) {
    await db.execute(
      `INSERT INTO test_run_items (
        id, run_id, test_case_id, title, module, priority, preconditions,
        steps, expected_result, status, notes, created_bug_id, executed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        item.id,
        item.run_id,
        item.test_case_id,
        item.title,
        item.module || '',
        item.priority,
        item.preconditions || '',
        item.steps || '',
        item.expected_result || '',
        item.status,
        item.notes || '',
        item.created_bug_id ?? null,
        item.executed_at ?? null,
      ],
    );
  }

  for (const session of validated.exploratory_sessions || []) {
    await db.execute(
      `INSERT INTO exploratory_sessions (
        id, charter, environment, build_version, module, notes, duration_seconds, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        session.id,
        session.charter,
        session.environment || '',
        session.build_version || '',
        session.module || '',
        session.notes || '',
        session.duration_seconds || 0,
        session.created_at,
        session.updated_at,
      ],
    );
  }

  for (const snip of validated.snippets || []) {
    await db.execute(
      `INSERT INTO snippets (
        id, title, category, content, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [snip.id, snip.title, snip.category, snip.content, snip.created_at, snip.updated_at],
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

// ============================================================================
// Phase 4: Integrations (Settings in SQLite, Secrets strictly in OS Keyring via Rust)
// ============================================================================
interface IntegrationMockState {
  secretStatus: IntegrationSecretStatus;
  externalTicketStatuses: Record<string, string>;
  ticketSeq: number;
  lastSlackSummarySent: string | null;
}

function createInitialIntegrationMockState(): IntegrationMockState {
  return {
    secretStatus: {
      jira_configured: false,
      azure_devops_configured: false,
      slack_configured: false,
    },
    externalTicketStatuses: {},
    ticketSeq: 100,
    lastSlackSummarySent: null,
  };
}

let integrationMockState: IntegrationMockState = createInitialIntegrationMockState();

export function resetIntegrationMockStateForTests(): void {
  integrationMockState = createInitialIntegrationMockState();
}

export function setMockExternalTicketStatusForTests(ticketKey: string, status: string): void {
  integrationMockState.externalTicketStatuses[ticketKey] = status;
}

export function getLastSlackSummarySentForTests(): string | null {
  return integrationMockState.lastSlackSummarySent;
}

const INTEGRATION_SETTINGS_PREF_KEY = 'integration_settings_v4';

export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  let rawJson: string | undefined;
  if (!isTauriRuntime()) {
    rawJson = memoryStore.preferences[INTEGRATION_SETTINGS_PREF_KEY];
  } else {
    const db = await getSqliteDb();
    const rows = await db.select<Array<{ value: string }>>(
      'SELECT value FROM app_preferences WHERE key = $1',
      [INTEGRATION_SETTINGS_PREF_KEY],
    );
    rawJson = rows[0]?.value;
  }

  if (!rawJson) {
    return {
      jira: { ...DEFAULT_INTEGRATION_SETTINGS.jira },
      azure_devops: { ...DEFAULT_INTEGRATION_SETTINGS.azure_devops },
      status_mappings: DEFAULT_STATUS_MAPPINGS.map((m) => ({ ...m })),
    };
  }

  try {
    const parsed = JSON.parse(rawJson) as Partial<IntegrationSettings>;
    return {
      jira: {
        deployment_type: parsed.jira?.deployment_type === 'server' ? 'server' : ('cloud' as const),
        base_url: parsed.jira?.base_url ?? '',
        email: parsed.jira?.email ?? '',
        project_key: parsed.jira?.project_key ?? 'QA',
        issue_type: parsed.jira?.issue_type ?? 'Bug',
      },
      azure_devops: {
        organization: parsed.azure_devops?.organization ?? '',
        project: parsed.azure_devops?.project ?? '',
        work_item_type: parsed.azure_devops?.work_item_type ?? 'Bug',
      },
      status_mappings:
        Array.isArray(parsed.status_mappings) && parsed.status_mappings.length > 0
          ? parsed.status_mappings.map((m) => ({
              external_status: String(m.external_status || '').trim(),
              target_column_name: String(m.target_column_name || '').trim(),
            }))
          : DEFAULT_STATUS_MAPPINGS.map((m) => ({ ...m })),
    };
  } catch {
    return {
      jira: { ...DEFAULT_INTEGRATION_SETTINGS.jira },
      azure_devops: { ...DEFAULT_INTEGRATION_SETTINGS.azure_devops },
      status_mappings: DEFAULT_STATUS_MAPPINGS.map((m) => ({ ...m })),
    };
  }
}

export async function saveIntegrationSettings(settings: IntegrationSettings): Promise<void> {
  // Explicitly construct only non-secret configuration fields before persisting
  const sanitized: IntegrationSettings = {
    jira: {
      deployment_type: settings.jira.deployment_type === 'server' ? 'server' : 'cloud',
      base_url: settings.jira.base_url.trim().replace(/\/+$/, ''),
      email: settings.jira.email.trim(),
      project_key: settings.jira.project_key.trim().toUpperCase() || 'QA',
      issue_type: settings.jira.issue_type.trim() || 'Bug',
    },
    azure_devops: {
      organization: settings.azure_devops.organization.trim(),
      project: settings.azure_devops.project.trim(),
      work_item_type: settings.azure_devops.work_item_type.trim() || 'Bug',
    },
    status_mappings: settings.status_mappings
      .map((m) => ({
        external_status: m.external_status.trim(),
        target_column_name: m.target_column_name.trim(),
      }))
      .filter((m) => m.external_status.length > 0 && m.target_column_name.length > 0),
  };

  const jsonValue = JSON.stringify(sanitized);
  if (!isTauriRuntime()) {
    memoryStore.preferences[INTEGRATION_SETTINGS_PREF_KEY] = jsonValue;
    return;
  }

  const db = await getSqliteDb();
  await db.execute(
    `INSERT INTO app_preferences (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [INTEGRATION_SETTINGS_PREF_KEY, jsonValue],
  );
}

export async function getIntegrationsSecretStatus(): Promise<IntegrationSecretStatus> {
  if (!isTauriRuntime()) {
    return { ...integrationMockState.secretStatus };
  }
  return invoke<IntegrationSecretStatus>('get_integrations_secret_status');
}

export async function saveIntegrationSecret(
  key: IntegrationSecretKey,
  secretValue: string,
): Promise<IntegrationSecretStatus> {
  const trimmed = secretValue.trim();
  if (!trimmed) {
    throw new Error('O valor do segredo não pode estar vazio.');
  }
  if (!isTauriRuntime()) {
    if (key === 'jira_api_secret') integrationMockState.secretStatus.jira_configured = true;
    if (key === 'azure_devops_pat')
      integrationMockState.secretStatus.azure_devops_configured = true;
    if (key === 'slack_webhook_url') integrationMockState.secretStatus.slack_configured = true;
    return { ...integrationMockState.secretStatus };
  }
  return invoke<IntegrationSecretStatus>('save_integration_secret', {
    key,
    secretValue: trimmed,
  });
}

export async function deleteIntegrationSecret(
  key: IntegrationSecretKey,
): Promise<IntegrationSecretStatus> {
  if (!isTauriRuntime()) {
    if (key === 'jira_api_secret') integrationMockState.secretStatus.jira_configured = false;
    if (key === 'azure_devops_pat')
      integrationMockState.secretStatus.azure_devops_configured = false;
    if (key === 'slack_webhook_url') integrationMockState.secretStatus.slack_configured = false;
    return { ...integrationMockState.secretStatus };
  }
  return invoke<IntegrationSecretStatus>('delete_integration_secret', { key });
}

export async function testJiraConnection(settings?: IntegrationSettings): Promise<string> {
  const cfg = settings ?? (await getIntegrationSettings());
  if (!isTauriRuntime()) {
    if (!integrationMockState.secretStatus.jira_configured) {
      throw new Error('Credencial do Jira não configurada no cofre do sistema.');
    }
    if (!cfg.jira.base_url.trim()) {
      throw new Error('Informe a URL base do Jira.');
    }
    return `Conexão com Jira (${cfg.jira.deployment_type === 'cloud' ? 'Cloud' : 'Data Center'}) validada com sucesso!`;
  }
  return invoke<string>('test_jira_connection', {
    deploymentType: cfg.jira.deployment_type,
    baseUrl: cfg.jira.base_url,
    email: cfg.jira.email,
  });
}

export async function testAdoConnection(settings?: IntegrationSettings): Promise<string> {
  const cfg = settings ?? (await getIntegrationSettings());
  if (!isTauriRuntime()) {
    if (!integrationMockState.secretStatus.azure_devops_configured) {
      throw new Error('PAT do Azure DevOps não configurado no cofre do sistema.');
    }
    if (!cfg.azure_devops.organization.trim() || !cfg.azure_devops.project.trim()) {
      throw new Error('Informe a organização e o projeto do Azure DevOps.');
    }
    return `Conexão com Azure DevOps (${cfg.azure_devops.organization}/${cfg.azure_devops.project}) validada com sucesso!`;
  }
  return invoke<string>('test_ado_connection', {
    organization: cfg.azure_devops.organization,
    project: cfg.azure_devops.project,
  });
}

export async function testSlackConnection(): Promise<string> {
  if (!isTauriRuntime()) {
    if (!integrationMockState.secretStatus.slack_configured) {
      throw new Error('Webhook do Slack não configurado no cofre do sistema.');
    }
    return 'Mensagem de teste enviada para o Slack com sucesso!';
  }
  return invoke<string>('test_slack_connection');
}

export async function createJiraIssueForBug(
  bug: BugCard,
  settings?: IntegrationSettings,
): Promise<BugCard> {
  const cfg = settings ?? (await getIntegrationSettings());
  const attachments = await listAttachmentsForParent('bug', bug.id);

  let ticket: ExternalTicketResult;
  if (!isTauriRuntime()) {
    if (!integrationMockState.secretStatus.jira_configured) {
      throw new Error('Credencial do Jira não configurada no cofre do sistema.');
    }
    integrationMockState.ticketSeq += 1;
    const key = `${cfg.jira.project_key || 'QA'}-${integrationMockState.ticketSeq}`;
    const baseUrl = cfg.jira.base_url.replace(/\/+$/, '') || 'https://jira.exemplo.local';
    ticket = {
      key,
      url: `${baseUrl}/browse/${key}`,
      status: 'To Do',
    };
    integrationMockState.externalTicketStatuses[key] = ticket.status;
  } else {
    ticket = await invoke<ExternalTicketResult>('create_jira_issue', {
      deploymentType: cfg.jira.deployment_type,
      baseUrl: cfg.jira.base_url,
      email: cfg.jira.email,
      projectKey: cfg.jira.project_key,
      issueType: cfg.jira.issue_type,
      title: bug.title,
      severity: bug.severity,
      priority: bug.priority,
      environment: bug.environment,
      buildVersion: bug.build_version,
      module: bug.module,
      stepsToReproduce: bug.steps_to_reproduce,
      expectedResult: bug.expected_result,
      actualResult: bug.actual_result,
      tags: bug.tags,
      attachments: attachments.map((a) => ({
        file_name: a.file_name,
        mime_type: a.mime_type,
        relative_path: a.relative_path,
      })),
    });
  }

  return updateBug(bug.id, {
    external_provider: 'jira',
    external_ticket_key: ticket.key,
    external_ticket_url: ticket.url,
    external_status: ticket.status,
  });
}

export async function createAdoWorkItemForBug(
  bug: BugCard,
  settings?: IntegrationSettings,
): Promise<BugCard> {
  const cfg = settings ?? (await getIntegrationSettings());
  const attachments = await listAttachmentsForParent('bug', bug.id);

  let ticket: ExternalTicketResult;
  if (!isTauriRuntime()) {
    if (!integrationMockState.secretStatus.azure_devops_configured) {
      throw new Error('PAT do Azure DevOps não configurado no cofre do sistema.');
    }
    integrationMockState.ticketSeq += 1;
    const idStr = String(integrationMockState.ticketSeq);
    const org = cfg.azure_devops.organization || 'org';
    const proj = cfg.azure_devops.project || 'proj';
    ticket = {
      key: idStr,
      url: `https://dev.azure.com/${org}/${proj}/_workitems/edit/${idStr}`,
      status: 'New',
    };
    integrationMockState.externalTicketStatuses[idStr] = ticket.status;
  } else {
    ticket = await invoke<ExternalTicketResult>('create_ado_work_item', {
      organization: cfg.azure_devops.organization,
      project: cfg.azure_devops.project,
      workItemType: cfg.azure_devops.work_item_type,
      title: bug.title,
      severity: bug.severity,
      priority: bug.priority,
      environment: bug.environment,
      buildVersion: bug.build_version,
      module: bug.module,
      stepsToReproduce: bug.steps_to_reproduce,
      expectedResult: bug.expected_result,
      actualResult: bug.actual_result,
      tags: bug.tags,
      attachments: attachments.map((a) => ({
        file_name: a.file_name,
        mime_type: a.mime_type,
        relative_path: a.relative_path,
      })),
    });
  }

  return updateBug(bug.id, {
    external_provider: 'azure_devops',
    external_ticket_key: ticket.key,
    external_ticket_url: ticket.url,
    external_status: ticket.status,
  });
}

export async function fetchExternalBugStatus(
  bug: BugCard,
  settings?: IntegrationSettings,
): Promise<string> {
  const cfg = settings ?? (await getIntegrationSettings());
  const key = bug.external_ticket_key.trim();
  if (!key || !bug.external_provider) {
    throw new Error('Este bug não possui um ticket externo vinculado.');
  }

  if (!isTauriRuntime()) {
    return integrationMockState.externalTicketStatuses[key] || bug.external_status || 'In Progress';
  }

  if (bug.external_provider === 'jira') {
    return invoke<string>('fetch_jira_issue_status', {
      deploymentType: cfg.jira.deployment_type,
      baseUrl: cfg.jira.base_url,
      email: cfg.jira.email,
      issueKey: key,
    });
  }

  return invoke<string>('fetch_ado_work_item_status', {
    organization: cfg.azure_devops.organization,
    project: cfg.azure_devops.project,
    workItemId: key,
  });
}

export async function checkExternalStatusUpdates(
  bugsToSync: BugCard[],
  columns: BoardColumn[],
  settings?: IntegrationSettings,
): Promise<StatusSyncProposal[]> {
  const cfg = settings ?? (await getIntegrationSettings());
  const linkedBugs = bugsToSync.filter(
    (b) => b.external_provider && b.external_ticket_key.trim().length > 0,
  );

  const proposals: StatusSyncProposal[] = [];

  for (const bug of linkedBugs) {
    const newExternalStatus = await fetchExternalBugStatus(bug, cfg);
    const currentCol = columns.find((c) => c.id === bug.column_id);
    const currentColumnName = currentCol?.name || 'Desconhecida';

    const matchedRule = cfg.status_mappings.find(
      (rule) =>
        rule.external_status.trim().toLowerCase() === newExternalStatus.trim().toLowerCase(),
    );

    let proposedCol = currentCol;
    if (matchedRule) {
      const targetCol = columns.find(
        (c) => c.name.trim().toLowerCase() === matchedRule.target_column_name.trim().toLowerCase(),
      );
      if (targetCol) {
        proposedCol = targetCol;
      }
    }

    const proposedColumnId = proposedCol?.id || bug.column_id;
    const proposedColumnName = proposedCol?.name || currentColumnName;
    const willMoveColumn = proposedColumnId !== bug.column_id;
    const statusChanged = newExternalStatus.trim() !== (bug.external_status || '').trim();

    if (willMoveColumn || statusChanged) {
      proposals.push({
        bug_id: bug.id,
        bug_title: bug.title,
        provider: bug.external_provider as 'jira' | 'azure_devops',
        ticket_key: bug.external_ticket_key,
        previous_external_status: bug.external_status || '—',
        new_external_status: newExternalStatus,
        current_column_id: bug.column_id,
        current_column_name: currentColumnName,
        proposed_column_id: proposedColumnId,
        proposed_column_name: proposedColumnName,
        will_move_column: willMoveColumn,
      });
    }
  }

  return proposals;
}

export async function applyExternalStatusProposals(proposals: StatusSyncProposal[]): Promise<void> {
  const allBugs = await listBugs();
  for (const prop of proposals) {
    const bug = allBugs.find((b) => b.id === prop.bug_id);
    if (!bug) continue;

    await updateBug(bug.id, {
      external_status: prop.new_external_status,
    });

    if (prop.will_move_column && prop.proposed_column_id !== bug.column_id) {
      const latestBugs = await listBugs();
      const targetColBugIds = latestBugs
        .filter((b) => b.column_id === prop.proposed_column_id && b.id !== bug.id)
        .map((b) => b.id);
      targetColBugIds.push(bug.id);
      await moveAndReorderBug(bug.id, prop.proposed_column_id, targetColBugIds);
    }
  }
}

export function buildSlackRunSummaryPreview(run: TestRun, items: TestRunItem[]): string {
  const passed = items.filter((i) => i.status === 'Passou').length;
  const failedItems = items.filter((i) => i.status === 'Falhou');
  const blocked = items.filter((i) => i.status === 'Bloqueado').length;
  const skipped = items.filter((i) => i.status === 'Pulado').length;
  const total = items.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  let text = `*QA Board — Resumo de Execução*\n`;
  text += `*${run.name}*`;
  if (run.build_version.trim()) {
    text += ` (${run.build_version.trim()})`;
  }
  if (run.environment.trim()) {
    text += ` • Ambiente: \`${run.environment.trim()}\``;
  }
  text += `\n• *${passed} passaram*, *${failedItems.length} falharam*, ${blocked} bloqueados, ${skipped} pulados (Taxa de aprovação: *${passRate}%*)\n`;

  if (failedItems.length > 0) {
    text += `\n*Casos que falharam (${failedItems.length}):*\n`;
    for (const item of failedItems.slice(0, 20)) {
      text += `• ❌ ${item.title}${item.module ? ` [${item.module}]` : ''}\n`;
    }
    if (failedItems.length > 20) {
      text += `• _...e mais ${failedItems.length - 20} falha(s)._\n`;
    }
  } else {
    text += `\n🎉 _Nenhuma falha registrada nesta execução!_\n`;
  }

  return text;
}

export async function sendSlackRunSummary(run: TestRun, items: TestRunItem[]): Promise<string> {
  const passedCount = items.filter((i) => i.status === 'Passou').length;
  const failedItems = items.filter((i) => i.status === 'Falhou');
  const blockedCount = items.filter((i) => i.status === 'Bloqueado').length;
  const skippedCount = items.filter((i) => i.status === 'Pulado').length;
  const failedCases = failedItems.map((i) => (i.module ? `${i.title} [${i.module}]` : i.title));

  if (!isTauriRuntime()) {
    if (!integrationMockState.secretStatus.slack_configured) {
      throw new Error('Webhook do Slack não configurado no cofre do sistema.');
    }
    integrationMockState.lastSlackSummarySent = buildSlackRunSummaryPreview(run, items);
    return 'Resumo da execução enviado ao Slack com sucesso!';
  }

  return invoke<string>('send_slack_run_summary', {
    runName: run.name,
    buildVersion: run.build_version,
    environment: run.environment,
    passedCount,
    failedCount: failedItems.length,
    blockedCount,
    skippedCount,
    failedCases,
  });
}
