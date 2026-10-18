import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../../App';
import {
  createBug,
  createTestCase,
  createTestRun,
  listTestRunItems,
  resetInMemoryStoreForTests,
  updateTestRunItem,
} from '../../db/database';
import {
  formatBugReport,
  formatTestRunMarkdownReport,
  generateTestRunPdfBytes,
  generateValidCnpj,
  generateValidCpf,
  isValidCnpj,
  isValidCpf,
} from './productivityUtils';

describe('Phase 3: Productivity, Templates, Reports (MD/PDF), Dashboard & Snippets', () => {
  beforeEach(() => {
    resetInMemoryStoreForTests();
  });

  it('generates bug reports in all three formats (Markdown, Jira, Azure DevOps)', async () => {
    const bug = await createBug({
      column_id: 'col-new',
      title: 'Erro 502 no gateway de pagamento',
      severity: 'Crítica',
      priority: 'P1 - Urgente',
      environment: 'Staging',
      build_version: 'v4.0.1',
      module: 'Pagamentos',
      tags: ['api', 'gateway'],
      steps_to_reproduce: '1. Enviar POST /pay\n2. Aguardar resposta',
      expected_result: 'HTTP 200 OK',
      actual_result: 'HTTP 502 Bad Gateway',
      external_ticket_url: 'https://jira.example.com/browse/PAY-99',
    });

    const md = formatBugReport(bug, 'markdown');
    expect(md).toContain('# [BUG] Erro 502 no gateway de pagamento');
    expect(md).toContain('## Passos para Reproduzir');
    expect(md).toContain('HTTP 502 Bad Gateway');

    const jira = formatBugReport(bug, 'jira');
    expect(jira).toContain('h2. [BUG] Erro 502 no gateway de pagamento');
    expect(jira).toContain('||Severidade||Prioridade||Módulo||Ambiente||Build||');
    expect(jira).toContain('{panel:title=Comportamento Observado (Falha)|borderStyle=solid}');

    const ado = formatBugReport(bug, 'azure_devops');
    expect(ado).toContain('### [Azure DevOps Bug] Erro 502 no gateway de pagamento');
    expect(ado).toContain('#### Repro Steps (Passos para Reproduzir)');
    expect(ado).toContain('#### Actual Result (Resultado Obtido)');
  });

  it('generates Test Run reports in both Markdown and valid PDF 1.4 binary format', async () => {
    const tc = await createTestCase({
      title: 'Validar emissão de nota fiscal',
      module: 'Fiscal',
      tags: ['nfe'],
      preconditions: 'Pedido faturado',
      steps: 'Clicar em Emitir NFe',
      expected_result: 'XML autorizado na SEFAZ',
      priority: 'P1 - Urgente',
    });

    const run = await createTestRun({
      name: 'Bateria Fiscal v4.0',
      build_version: 'v4.0.1',
      environment: 'Homologação',
      test_case_ids: [tc.id],
    });

    const items = await listTestRunItems(run.id);
    await updateTestRunItem(items[0].id, {
      status: 'Passou',
      notes: 'NFe emitida em 1.2s',
    });

    const updatedItems = await listTestRunItems(run.id);
    const mdReport = formatTestRunMarkdownReport(run, updatedItems);
    expect(mdReport).toContain('# Relatório de Execução de Testes: Bateria Fiscal v4.0');
    expect(mdReport).toContain('**Taxa de Aprovação:** 100% (1/1)');
    expect(mdReport).toContain('Validar emissão de nota fiscal');

    const pdfBytes = generateTestRunPdfBytes(run, updatedItems);
    const pdfText = new TextDecoder().decode(pdfBytes);
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfText).toContain('Bateria Fiscal v4.0');
    expect(pdfText.trim().endsWith('%%EOF')).toBe(true);
  });

  it('generates mathematically valid CPFs and CNPJs locally', () => {
    for (let i = 0; i < 15; i++) {
      const cpfFmt = generateValidCpf(true);
      const cpfRaw = generateValidCpf(false);
      expect(cpfFmt).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
      expect(cpfRaw).toMatch(/^\d{11}$/);
      expect(isValidCpf(cpfFmt)).toBe(true);
      expect(isValidCpf(cpfRaw)).toBe(true);

      const cnpjFmt = generateValidCnpj(true);
      const cnpjRaw = generateValidCnpj(false);
      expect(cnpjFmt).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
      expect(cnpjRaw).toMatch(/^\d{14}$/);
      expect(isValidCnpj(cnpjFmt)).toBe(true);
      expect(isValidCnpj(cnpjRaw)).toBe(true);
    }
  });

  it('renders Dashboard, switches Bug Report formats, exports Run Report, and uses Quick Capture', async () => {
    await createBug({
      column_id: 'col-new',
      title: 'Bug exibido no Dashboard e Templates',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: 'Homologação',
      build_version: 'v2.4.0',
      module: 'Checkout',
      tags: ['checkout'],
      steps_to_reproduce: 'Passo A',
      expected_result: 'Esperado A',
      actual_result: 'Obtido A',
      external_ticket_url: '',
    });

    const tc = await createTestCase({
      title: 'Caso para exportar relatório',
      module: 'Checkout',
      tags: [],
      preconditions: '',
      steps: 'Passo 1',
      expected_result: 'Ok',
      priority: 'P2 - Alta',
    });

    await createTestRun({
      name: 'Run Exportável v2.4',
      build_version: 'v2.4.0',
      environment: 'QA',
      test_case_ids: [tc.id],
    });

    render(<App />);

    // Open Produtividade & Relatórios
    const reportsNav = await screen.findByRole('button', {
      name: /Produtividade & Relatórios/i,
    });
    fireEvent.click(reportsNav);

    await waitFor(() => {
      expect(screen.getByText('Bugs por Status (Coluna)')).toBeInTheDocument();
      expect(screen.getByText('Comparação entre Builds')).toBeInTheDocument();
    });

    // Switch to Templates de Bug Report
    fireEvent.click(screen.getByRole('button', { name: /Templates de Bug Report/i }));
    expect(screen.getByTestId('bug-report-output').textContent).toContain(
      '# [BUG] Bug exibido no Dashboard e Templates',
    );

    fireEvent.click(screen.getByRole('button', { name: /Formato Jira/i }));
    expect(screen.getByTestId('bug-report-output').textContent).toContain(
      'h2. [BUG] Bug exibido no Dashboard e Templates',
    );

    fireEvent.click(screen.getByRole('button', { name: /Formato Azure DevOps/i }));
    expect(screen.getByTestId('bug-report-output').textContent).toContain(
      '### [Azure DevOps Bug] Bug exibido no Dashboard e Templates',
    );

    // Switch to Exportar Test Run (MD / PDF)
    fireEvent.click(screen.getByRole('button', { name: /Exportar Test Run \(MD \/ PDF\)/i }));
    expect(screen.getByTestId('run-report-preview').textContent).toContain('Run Exportável v2.4');

    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF \(\.pdf\)/i }));
    await waitFor(() => {
      expect(screen.getByText(/Relatório PDF gerado e exportado com sucesso/i)).toBeInTheDocument();
    });

    // Test Quick Capture Modal
    fireEvent.click(screen.getByRole('button', { name: /Captura Rápida/i }));
    const qcTitle = await screen.findByLabelText(/Título Rápido do Bug/i);
    fireEvent.change(qcTitle, { target: { value: 'Bug via Captura Rápida' } });
    fireEvent.click(screen.getByRole('button', { name: /Registrar Bug Agora/i }));
  });
});
