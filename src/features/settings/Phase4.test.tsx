import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../App';
import {
  createBug,
  createTestCase,
  createTestRun,
  getIntegrationSettings,
  getLastSlackSummarySentForTests,
  listBugs,
  resetInMemoryStoreForTests,
  saveIntegrationSecret,
  saveIntegrationSettings,
  setMockExternalTicketStatusForTests,
  updateTestRunItem,
  listTestRunItems,
} from '../../db/database';
import { DEFAULT_INTEGRATION_SETTINGS } from '../../types/models';

describe('Phase 4: Secure Integrations (Jira, Azure DevOps, Slack & Status Sync Preview)', () => {
  beforeEach(() => {
    resetInMemoryStoreForTests();
  });

  it('stores secrets strictly in vault status without exposing them in UI or SQLite preferences', async () => {
    render(<App />);

    // Navigate to Settings & Integrations
    const settingsNav = screen.getByRole('button', { name: /Configurações & Integrações/i });
    fireEvent.click(settingsNav);

    const jiraBadge = await screen.findByTestId('jira-secret-status-badge');
    expect(jiraBadge.textContent).toBe('Não configurado');

    // Enter a Jira token and save to OS Vault
    const jiraSecretInput = screen.getByLabelText('Segredo do Jira') as HTMLInputElement;
    fireEvent.change(jiraSecretInput, { target: { value: 'super-secret-jira-token-999' } });
    fireEvent.click(screen.getByTestId('save-jira-secret-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('jira-secret-status-badge').textContent).toBe('Configurado');
    });

    // Verify input is no longer rendered/populated and secret is nowhere in DOM or preferences
    expect(screen.queryByDisplayValue('super-secret-jira-token-999')).toBeNull();
    const savedPrefs = await getIntegrationSettings();
    expect(JSON.stringify(savedPrefs)).not.toContain('super-secret-jira-token-999');

    // Fill Jira Base URL and test connection
    const baseUrlInput = screen.getByLabelText('URL Base do Jira');
    fireEvent.change(baseUrlInput, { target: { value: 'https://empresa.atlassian.net' } });
    fireEvent.click(screen.getByTestId('test-jira-connection-btn'));

    await waitFor(() => {
      expect(screen.getAllByText(/Conexão com Jira/i).length).toBeGreaterThan(0);
    });
  });

  it('creates Jira/ADO tickets from a bug card and previews status changes before moving columns', async () => {
    await saveIntegrationSecret('jira_api_secret', 'token-jira-123');
    await saveIntegrationSettings({
      ...DEFAULT_INTEGRATION_SETTINGS,
      jira: {
        deployment_type: 'cloud',
        base_url: 'https://empresa.atlassian.net',
        email: 'qa@empresa.com',
        project_key: 'QA',
        issue_type: 'Bug',
      },
    });

    const bug = await createBug({
      column_id: 'col-new',
      title: 'Erro 500 ao calcular frete internacional',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: 'Homologação',
      build_version: 'v2.4.0',
      module: 'Logística',
      tags: ['frete'],
      steps_to_reproduce: '1. Informar CEP exterior',
      expected_result: 'Cotação exibida',
      actual_result: 'HTTP 500',
      external_ticket_url: '',
    });

    render(<App />);

    // Open bug modal and push to Jira
    const bugCardBtn = await screen.findByText('Erro 500 ao calcular frete internacional');
    fireEvent.click(bugCardBtn);

    const createJiraBtn = await screen.findByTestId('create-jira-issue-btn');
    fireEvent.click(createJiraBtn);

    await waitFor(() => {
      expect(screen.getByTestId('bug-modal-external-badge').textContent).toContain('QA-101');
    });

    // Close modal
    fireEvent.click(screen.getByLabelText('Fechar modal'));

    // Simulate external Jira issue moving to "Done" (mapped to "Fechado" column: col-closed)
    setMockExternalTicketStatusForTests('QA-101', 'Done');

    // Click "Atualizar Status (1)" on the Board
    const syncBtn = await screen.findByTestId('sync-all-statuses-btn');
    fireEvent.click(syncBtn);

    // Verify StatusSyncModal opens with preview BEFORE modifying the bug's column
    const proposalRow = await screen.findByTestId(`sync-proposal-${bug.id}`);
    expect(proposalRow.textContent).toContain('Done');
    expect(proposalRow.textContent).toContain('Fechado');

    // Ensure bug has NOT moved yet prior to user confirmation
    let currentBugs = await listBugs();
    expect(currentBugs[0].column_id).toBe('col-new');

    // Confirm status sync
    fireEvent.click(screen.getByTestId('confirm-status-sync-btn'));

    await waitFor(async () => {
      currentBugs = await listBugs();
      expect(currentBugs[0].column_id).toBe('col-closed');
      expect(currentBugs[0].external_status).toBe('Done');
    });
  });

  it('previews and sends a Test Run summary to Slack with passed/failed counts and failed list', async () => {
    await saveIntegrationSecret('slack_webhook_url', 'https://hooks.slack.com/services/T1/B1/X1');

    const tc1 = await createTestCase({
      title: 'Login com MFA válido',
      module: 'Auth',
      tags: ['smoke'],
      preconditions: 'Usuário ativo',
      steps: 'Inserir OTP',
      expected_result: 'Acesso liberado',
      priority: 'P1 - Urgente',
    });
    const tc2 = await createTestCase({
      title: 'Estorno de pagamento PIX',
      module: 'Pagamentos',
      tags: ['regressão'],
      preconditions: 'Pedido pago',
      steps: 'Solicitar estorno',
      expected_result: 'Valor devolvido',
      priority: 'P1 - Urgente',
    });

    const run = await createTestRun({
      name: 'Regressão v2.4',
      build_version: 'v2.4.0',
      environment: 'Staging',
      test_case_ids: [tc1.id, tc2.id],
    });

    const items = await listTestRunItems(run.id);
    await updateTestRunItem(items[0].id, { status: 'Passou' });
    await updateTestRunItem(items[1].id, { status: 'Falhou', notes: 'Timeout no gateway' });

    render(<App />);

    // Navigate to Test Runs
    fireEvent.click(screen.getByRole('button', { name: /Execuções \(Test Runs\)/i }));

    const openSlackBtn = await screen.findByTestId('open-slack-preview-btn');
    fireEvent.click(openSlackBtn);

    const previewPre = await screen.findByTestId('slack-preview-content');
    expect(previewPre.textContent).toContain('Regressão v2.4');
    expect(previewPre.textContent).toContain('1 passaram');
    expect(previewPre.textContent).toContain('1 falharam');
    expect(previewPre.textContent).toContain('Estorno de pagamento PIX');

    fireEvent.click(screen.getByTestId('confirm-send-slack-btn'));

    await waitFor(() => {
      expect(getLastSlackSummarySentForTests()).toContain('Regressão v2.4');
    });
  });
});
