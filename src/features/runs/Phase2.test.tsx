import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../../App';
import {
  createBug,
  createExploratorySession,
  createTestCase,
  createTestRun,
  generateBugFromRunItem,
  listAttachmentsForParent,
  listBugs,
  listChecklists,
  listExploratorySessions,
  listTestRunItems,
  resetInMemoryStoreForTests,
  saveAttachmentForParent,
  updateChecklist,
  updateExploratorySession,
  updateTestRunItem,
} from '../../db/database';

describe('Phase 2: Test Cases, Checklists, Test Runs & Exploratory Sessions', () => {
  beforeEach(() => {
    resetInMemoryStoreForTests();
  });

  it('seeds default reusable checklists (Smoke, Regressão, Pré-Release) and links test cases', async () => {
    const checklists = await listChecklists();
    expect(checklists.map((c) => c.category)).toEqual(
      expect.arrayContaining(['Smoke', 'Regressão', 'Pré-Release']),
    );

    const tc = await createTestCase({
      title: 'Validar login com 2FA',
      module: 'Autenticação',
      tags: ['smoke', 'segurança'],
      preconditions: 'Usuário com 2FA ativo',
      steps: '1. Informar e-mail e senha\n2. Informar token OTP',
      expected_result: 'Acesso liberado ao painel',
      priority: 'P1 - Urgente',
    });

    const smokeChecklist = checklists.find((c) => c.category === 'Smoke')!;
    const updatedChk = await updateChecklist(smokeChecklist.id, {
      test_case_ids: [tc.id],
    });
    expect(updatedChk.test_case_ids).toContain(tc.id);
  });

  it('executes a test run, marks statuses, copies attachments, and generates a bug from a failure', async () => {
    const tc1 = await createTestCase({
      title: 'Pagamento com cartão expirado',
      module: 'Checkout',
      tags: ['pagamento'],
      preconditions: 'Carrinho com 1 item',
      steps: '1. Inserir cartão vencido\n2. Clicar em Pagar',
      expected_result: 'Exibir mensagem amigável de cartão vencido',
      priority: 'P1 - Urgente',
    });

    const tc2 = await createTestCase({
      title: 'Cálculo de frete expresso',
      module: 'Logística',
      tags: ['frete'],
      preconditions: 'CEP válido informado',
      steps: '1. Informar CEP\n2. Selecionar Frete Expresso',
      expected_result: 'Valor do frete somado ao total',
      priority: 'P2 - Alta',
    });

    const run = await createTestRun({
      name: 'Execução Pré-Release v3.0',
      build_version: 'v3.0.0-rc1',
      environment: 'Staging',
      test_case_ids: [tc1.id, tc2.id],
    });

    const items = await listTestRunItems(run.id);
    expect(items).toHaveLength(2);

    // Mark first item as Falhou with notes and attachment
    await updateTestRunItem(items[0].id, {
      status: 'Falhou',
      notes: 'Retornou erro 500 sem mensagem amigável ao usuário.',
    });
    await saveAttachmentForParent({
      parentType: 'run_item',
      parentId: items[0].id,
      fileName: 'erro-500-checkout.png',
      mimeType: 'image/png',
      base64Data: 'cHJpbnQtZGF0YQ==',
    });

    // Mark second item as Passou
    await updateTestRunItem(items[1].id, {
      status: 'Passou',
      notes: 'Frete calculado em 180ms.',
    });

    const refreshedItems = await listTestRunItems(run.id);
    const failedItem = refreshedItems.find((i) => i.id === items[0].id)!;
    const generatedBug = await generateBugFromRunItem(run, failedItem);

    expect(generatedBug.title).toBe('[Falha em Execução] Pagamento com cartão expirado');
    expect(generatedBug.build_version).toBe('v3.0.0-rc1');
    expect(generatedBug.environment).toBe('Staging');
    expect(generatedBug.actual_result).toBe('Retornou erro 500 sem mensagem amigável ao usuário.');

    const bugAttachments = await listAttachmentsForParent('bug', generatedBug.id);
    expect(bugAttachments).toHaveLength(1);
    expect(bugAttachments[0].file_name).toBe('erro-500-checkout.png');
  });

  it('manages exploratory testing sessions with charter, timer, quick notes, and session bugs', async () => {
    const session = await createExploratorySession({
      charter: 'Explorar importação de planilhas grandes no módulo fiscal',
      environment: 'Homologação',
      build_version: 'v2.9.0',
      module: 'Fiscal',
      notes: 'Planilha com 50 mil linhas demorou 12s.',
      duration_seconds: 120,
    });

    const updated = await updateExploratorySession(session.id, {
      notes: 'Planilha com 50 mil linhas demorou 12s. Com 100 mil linhas ocorreu timeout.',
      duration_seconds: 600,
    });
    expect(updated.duration_seconds).toBe(600);

    await createBug({
      column_id: 'col-new',
      title: 'Timeout ao importar planilha com 100 mil linhas',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: session.environment,
      build_version: session.build_version,
      module: session.module,
      tags: ['exploratório'],
      steps_to_reproduce: 'Importar CSV de 100k linhas',
      expected_result: 'Processar em background',
      actual_result: 'Erro 504 Gateway Timeout',
      external_ticket_url: '',
      exploratory_session_id: session.id,
    });

    const sessions = await listExploratorySessions();
    expect(sessions).toHaveLength(1);

    const bugs = await listBugs();
    expect(bugs.filter((b) => b.exploratory_session_id === session.id)).toHaveLength(1);
  });

  it('completes end-to-end UI flow: create test case -> execute run -> fail -> generate bug', async () => {
    render(<App />);

    // 1. Go to Casos de Teste
    const casesNavBtn = await screen.findByRole('button', { name: /Casos de Teste/i });
    fireEvent.click(casesNavBtn);

    const newCaseBtn = await screen.findByRole('button', { name: /Novo Caso de Teste/i });
    fireEvent.click(newCaseBtn);

    fireEvent.change(screen.getByLabelText(/Título do Caso de Teste/i), {
      target: { value: 'Finalizar pedido com Pix' },
    });
    fireEvent.change(screen.getByLabelText(/^Passos$/i), {
      target: { value: '1. Escolher Pix\n2. Confirmar pedido' },
    });
    fireEvent.change(screen.getByLabelText(/Resultado Esperado/i), {
      target: { value: 'QR Code exibido na tela' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Criar Caso de Teste$/i }));

    await waitFor(() => {
      expect(screen.getByText('Finalizar pedido com Pix')).toBeInTheDocument();
    });

    // 2. Go to Execuções (Test Runs)
    const runsNavBtn = screen.getByRole('button', { name: /Execuções \(Test Runs\)/i });
    fireEvent.click(runsNavBtn);

    const newRunBtn = await screen.findByRole('button', { name: /^Nova Execução$/i });
    fireEvent.click(newRunBtn);

    fireEvent.change(screen.getByLabelText(/Nome da Execução/i), {
      target: { value: 'Smoke Release v2.4' },
    });
    fireEvent.change(screen.getByLabelText(/Versão \/ Build/i), {
      target: { value: 'v2.4.0' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Iniciar Execução/i }));

    // 3. Mark case as Falhou and Generate Bug
    const failBtn = await screen.findByRole('button', {
      name: /Marcar Finalizar pedido com Pix como Falhou/i,
    });
    fireEvent.click(failBtn);

    const generateBugBtn = await screen.findByRole('button', {
      name: /Gerar bug a partir de falha em Finalizar pedido com Pix/i,
    });
    fireEvent.click(generateBugBtn);

    await waitFor(() => {
      expect(screen.getByText('Bug gerado no Board')).toBeInTheDocument();
    });
  });
});
