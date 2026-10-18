import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildBackupPayload,
  createBug,
  createColumn,
  deleteColumn,
  filterBugs,
  listAttachmentsForParent,
  listBugs,
  listColumns,
  moveAndReorderBug,
  resetInMemoryStoreForTests,
  restoreFromBackupPayload,
  saveAttachmentForParent,
  updateBug,
  updateColumnName,
  validateBackupPayload,
} from '../../db/database';

describe('Database & Backup Repository Logic (Phase 1)', () => {
  beforeEach(() => {
    resetInMemoryStoreForTests();
  });

  it('supports editable columns (create, rename, delete empty, prevent deleting non-empty)', async () => {
    const initialCols = await listColumns();
    expect(initialCols).toHaveLength(6);

    const added = await createColumn('Homologação');
    expect(added.name).toBe('Homologação');

    await updateColumnName(added.id, 'Validação');
    const afterRename = await listColumns();
    expect(afterRename.find((c) => c.id === added.id)?.name).toBe('Validação');

    // Add a bug to the column and verify deletion is blocked
    await createBug({
      column_id: added.id,
      title: 'Bug bloqueando exclusão de coluna',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: 'QA',
      build_version: 'v1.0',
      module: 'Auth',
      tags: ['login'],
      steps_to_reproduce: 'Passo 1',
      expected_result: 'Ok',
      actual_result: 'Falha',
      external_ticket_url: '',
    });

    await expect(deleteColumn(added.id)).rejects.toThrow(/Mova ou exclua os cards/i);
  });

  it('tracks reopened_count when moving a bug out of Fechado column and persists order', async () => {
    const bug1 = await createBug({
      column_id: 'col-closed',
      title: 'Bug fechado que regrediu',
      severity: 'Crítica',
      priority: 'P1 - Urgente',
      environment: 'Prod',
      build_version: 'v2.0',
      module: 'Pagamentos',
      tags: ['pix'],
      steps_to_reproduce: '1. Pagar com Pix',
      expected_result: 'Sucesso',
      actual_result: 'Timeout',
      external_ticket_url: 'https://jira.example.com/browse/QA-10',
    });

    expect(bug1.reopened_count).toBe(0);

    await moveAndReorderBug(bug1.id, 'col-retest', [bug1.id]);
    const bugsAfterReopen = await listBugs();
    const reopened = bugsAfterReopen.find((b) => b.id === bug1.id);
    expect(reopened?.column_id).toBe('col-retest');
    expect(reopened?.reopened_count).toBe(1);
  });

  it('filters bugs by text, tag, status, severity, module, and build', async () => {
    await createBug({
      column_id: 'col-new',
      title: 'Falha no login social Google',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: 'Staging',
      build_version: 'v3.1.0',
      module: 'Autenticação',
      tags: ['oauth', 'mobile'],
      steps_to_reproduce: 'Clicar em entrar com Google',
      expected_result: 'Entrar',
      actual_result: 'Erro 403',
      external_ticket_url: '',
    });

    await createBug({
      column_id: 'col-reported',
      title: 'Desalinhamento no rodapé',
      severity: 'Baixa',
      priority: 'P4 - Baixa',
      environment: 'Dev',
      build_version: 'v3.2.0',
      module: 'Layout',
      tags: ['ui'],
      steps_to_reproduce: 'Rolar até o fim',
      expected_result: 'Alinhado',
      actual_result: 'Torto',
      external_ticket_url: '',
    });

    const all = await listBugs();
    expect(
      filterBugs(all, {
        search: 'Google',
        tag: '',
        columnId: '',
        severity: '',
        module: '',
        buildVersion: '',
      }),
    ).toHaveLength(1);

    expect(
      filterBugs(all, {
        search: '',
        tag: 'oauth',
        columnId: 'col-new',
        severity: 'Alta',
        module: 'Autentica',
        buildVersion: 'v3.1',
      }),
    ).toHaveLength(1);
  });

  it('exports and imports backup payload with attachments and validates schema', async () => {
    const bug = await createBug({
      column_id: 'col-new',
      title: 'Bug com print anexado',
      severity: 'Média',
      priority: 'P3 - Média',
      environment: 'QA',
      build_version: 'v1.2',
      module: 'Relatórios',
      tags: ['export'],
      steps_to_reproduce: 'Exportar CSV',
      expected_result: 'Arquivo gerado',
      actual_result: 'Arquivo vazio',
      external_ticket_url: '',
    });

    await saveAttachmentForParent({
      parentType: 'bug',
      parentId: bug.id,
      fileName: 'evidencia.png',
      mimeType: 'image/png',
      base64Data: 'aGVsbG8=',
    });

    const backup = await buildBackupPayload();
    expect(backup.bugs).toHaveLength(1);
    expect(backup.attachments).toHaveLength(1);

    // Reset store and restore from backup
    resetInMemoryStoreForTests();
    expect(await listBugs()).toHaveLength(0);

    await restoreFromBackupPayload(backup);
    const restoredBugs = await listBugs();
    expect(restoredBugs).toHaveLength(1);
    expect(restoredBugs[0].title).toBe('Bug com print anexado');

    const restoredAtts = await listAttachmentsForParent('bug', bug.id);
    expect(restoredAtts).toHaveLength(1);
    expect(restoredAtts[0].file_name).toBe('evidencia.png');

    // Verify invalid backup payload throws error
    expect(() => validateBackupPayload({ version: 1, columns: [] })).toThrow();
    await updateBug(bug.id, { title: 'Título atualizado' });
    expect((await listBugs())[0].title).toBe('Título atualizado');
  });
});
