export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'v1_initial_mvp_bugs_board_attachments_preferences',
    statements: [
      `CREATE TABLE IF NOT EXISTS board_columns (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_done_column INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS bugs (
        id TEXT PRIMARY KEY NOT NULL,
        column_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'Média',
        priority TEXT NOT NULL DEFAULT 'P3 - Média',
        environment TEXT NOT NULL DEFAULT '',
        build_version TEXT NOT NULL DEFAULT '',
        module TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        steps_to_reproduce TEXT NOT NULL DEFAULT '',
        expected_result TEXT NOT NULL DEFAULT '',
        actual_result TEXT NOT NULL DEFAULT '',
        external_ticket_url TEXT NOT NULL DEFAULT '',
        external_ticket_key TEXT NOT NULL DEFAULT '',
        external_provider TEXT NOT NULL DEFAULT '',
        external_status TEXT NOT NULL DEFAULT '',
        reopened_count INTEGER NOT NULL DEFAULT 0,
        test_run_item_id TEXT,
        exploratory_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (column_id) REFERENCES board_columns(id)
      );`,
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY NOT NULL,
        parent_type TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS app_preferences (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );`,
    ],
  },
  {
    version: 2,
    name: 'v2_test_cases_checklists_runs_exploratory_sessions',
    statements: [
      `CREATE TABLE IF NOT EXISTS test_cases (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        module TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        preconditions TEXT NOT NULL DEFAULT '',
        steps TEXT NOT NULL DEFAULT '',
        expected_result TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'P3 - Média',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS checklists (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Smoke',
        description TEXT NOT NULL DEFAULT '',
        test_case_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        build_version TEXT NOT NULL DEFAULT '',
        environment TEXT NOT NULL DEFAULT '',
        checklist_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS test_run_items (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        test_case_id TEXT NOT NULL,
        title TEXT NOT NULL,
        module TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'P3 - Média',
        preconditions TEXT NOT NULL DEFAULT '',
        steps TEXT NOT NULL DEFAULT '',
        expected_result TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Pendente',
        notes TEXT NOT NULL DEFAULT '',
        created_bug_id TEXT,
        executed_at TEXT,
        FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS exploratory_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        charter TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT '',
        build_version TEXT NOT NULL DEFAULT '',
        module TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
    ],
  },
];
