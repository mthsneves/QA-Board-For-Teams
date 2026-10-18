export type BugSeverity = 'Crítica' | 'Alta' | 'Média' | 'Baixa';

export type BugPriority = 'P1 - Urgente' | 'P2 - Alta' | 'P3 - Média' | 'P4 - Baixa';

export type ThemeMode = 'dark' | 'light';

export interface BoardColumn {
  id: string;
  name: string;
  position: number;
  is_done_column: boolean;
  created_at: string;
}

export interface AttachmentRecord {
  id: string;
  parent_type: 'bug' | 'run_item' | 'exploratory';
  parent_id: string;
  file_name: string;
  mime_type: string;
  relative_path: string;
  size_bytes: number;
  created_at: string;
  /** Optional runtime base64 data URL used in non-Tauri test/browser mode */
  inline_base64?: string;
}

export interface BugCard {
  id: string;
  column_id: string;
  position: number;
  title: string;
  severity: BugSeverity;
  priority: BugPriority;
  environment: string;
  build_version: string;
  module: string;
  tags: string[];
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  external_ticket_url: string;
  external_ticket_key: string;
  external_provider: '' | 'jira' | 'azure_devops';
  external_status: string;
  reopened_count: number;
  test_run_item_id: string | null;
  exploratory_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BugInput {
  column_id: string;
  title: string;
  severity: BugSeverity;
  priority: BugPriority;
  environment: string;
  build_version: string;
  module: string;
  tags: string[];
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  external_ticket_url: string;
  external_ticket_key?: string;
  external_provider?: '' | 'jira' | 'azure_devops';
  external_status?: string;
  test_run_item_id?: string | null;
  exploratory_session_id?: string | null;
}

export interface BugFilters {
  search: string;
  tag: string;
  columnId: string;
  severity: string;
  module: string;
  buildVersion: string;
}

export interface BackupPayload {
  version: number;
  exported_at: string;
  theme: ThemeMode;
  columns: BoardColumn[];
  bugs: BugCard[];
  attachments: AttachmentRecord[];
}

export const DEFAULT_BOARD_COLUMNS: Array<
  Pick<BoardColumn, 'id' | 'name' | 'position' | 'is_done_column'>
> = [
  { id: 'col-new', name: 'Novo', position: 0, is_done_column: false },
  { id: 'col-analysis', name: 'Em análise', position: 1, is_done_column: false },
  { id: 'col-reported', name: 'Reportado', position: 2, is_done_column: false },
  { id: 'col-waiting-fix', name: 'Aguardando fix', position: 3, is_done_column: false },
  { id: 'col-retest', name: 'Reteste', position: 4, is_done_column: false },
  { id: 'col-closed', name: 'Fechado', position: 5, is_done_column: true },
];

export const SEVERITY_OPTIONS: BugSeverity[] = ['Crítica', 'Alta', 'Média', 'Baixa'];

export const PRIORITY_OPTIONS: BugPriority[] = [
  'P1 - Urgente',
  'P2 - Alta',
  'P3 - Média',
  'P4 - Baixa',
];
