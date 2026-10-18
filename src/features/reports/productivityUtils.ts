import { BugCard, BugReportFormat, TestRun, TestRunItem } from '../../types/models';

// ============================================================================
// 1. Bug Report Templates (Markdown, Jira, Azure DevOps)
// ============================================================================
export function formatBugReport(bug: BugCard, format: BugReportFormat): string {
  const tagsStr = bug.tags.length > 0 ? bug.tags.join(', ') : 'Nenhuma';
  const envStr = bug.environment || 'Não informado';
  const buildStr = bug.build_version || 'Não informada';
  const modStr = bug.module || 'Geral';
  const stepsStr = bug.steps_to_reproduce || '1. (Não especificado)';
  const expectedStr = bug.expected_result || '(Não especificado)';
  const actualStr = bug.actual_result || '(Não especificado)';

  if (format === 'markdown') {
    return [
      `# [BUG] ${bug.title}`,
      '',
      `- **Severidade:** ${bug.severity}`,
      `- **Prioridade:** ${bug.priority}`,
      `- **Módulo / Feature:** ${modStr}`,
      `- **Ambiente:** ${envStr}`,
      `- **Versão / Build:** ${buildStr}`,
      `- **Tags:** ${tagsStr}`,
      bug.external_ticket_url ? `- **Ticket Externo:** ${bug.external_ticket_url}` : '',
      '',
      '## Passos para Reproduzir',
      stepsStr,
      '',
      '## Resultado Esperado',
      expectedStr,
      '',
      '## Resultado Obtido',
      actualStr,
    ]
      .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
      .join('\n');
  }

  if (format === 'jira') {
    return [
      `h2. [BUG] ${bug.title}`,
      '',
      '||Severidade||Prioridade||Módulo||Ambiente||Build||',
      `|${bug.severity}|${bug.priority}|${modStr}|${envStr}|${buildStr}|`,
      '',
      `*Tags:* ${tagsStr}`,
      '',
      'h3. Passos para Reproduzir',
      stepsStr,
      '',
      'h3. Resultado Esperado',
      '{panel:title=Comportamento Esperado|borderStyle=solid}',
      expectedStr,
      '{panel}',
      '',
      'h3. Resultado Obtido',
      '{panel:title=Comportamento Observado (Falha)|borderStyle=solid}',
      actualStr,
      '{panel}',
    ].join('\n');
  }

  // format === 'azure_devops'
  return [
    `### [Azure DevOps Bug] ${bug.title}`,
    '',
    '#### System Info (Ambiente e Build)',
    `- **Environment:** ${envStr}`,
    `- **Build / Version:** ${buildStr}`,
    `- **Area / Module:** ${modStr}`,
    `- **Severity:** ${bug.severity} | **Priority:** ${bug.priority}`,
    `- **Tags:** ${tagsStr}`,
    '',
    '#### Repro Steps (Passos para Reproduzir)',
    stepsStr,
    '',
    '#### Expected Result (Resultado Esperado)',
    expectedStr,
    '',
    '#### Actual Result (Resultado Obtido)',
    actualStr,
  ].join('\n');
}

// ============================================================================
// 2. Test Run Reports (Markdown & Self-Contained PDF 1.4 Generator)
// ============================================================================
export function formatTestRunMarkdownReport(run: TestRun, items: TestRunItem[]): string {
  const total = items.length;
  const passed = items.filter((i) => i.status === 'Passou').length;
  const failed = items.filter((i) => i.status === 'Falhou').length;
  const blocked = items.filter((i) => i.status === 'Bloqueado').length;
  const skipped = items.filter((i) => i.status === 'Pulado').length;
  const pending = items.filter((i) => i.status === 'Pendente').length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const lines: string[] = [
    `# Relatório de Execução de Testes: ${run.name}`,
    '',
    `- **Build / Versão:** ${run.build_version || 'N/A'}`,
    `- **Ambiente:** ${run.environment || 'N/A'}`,
    `- **Data da Execução:** ${new Date(run.created_at).toLocaleString('pt-BR')}`,
    `- **Taxa de Aprovação:** ${passRate}% (${passed}/${total})`,
    '',
    '## Resumo de Resultados',
    '',
    '| Status | Quantidade |',
    '| :--- | :---: |',
    `| Passou | ${passed} |`,
    `| Falhou | ${failed} |`,
    `| Bloqueado | ${blocked} |`,
    `| Pulado | ${skipped} |`,
    `| Pendente | ${pending} |`,
    `| **Total** | **${total}** |`,
    '',
    '## Detalhamento dos Casos Executados',
    '',
    '| Caso de Teste | Módulo | Prioridade | Status | Observações |',
    '| :--- | :--- | :--- | :---: | :--- |',
  ];

  for (const item of items) {
    const cleanNotes = (item.notes || '-').replace(/\r?\n/g, ' ');
    lines.push(
      `| ${item.title} | ${item.module || '-'} | ${item.priority} | **${item.status}** | ${cleanNotes} |`,
    );
  }

  return lines.join('\n');
}

function escapePdfText(input: string): string {
  // Replace non-Latin1 chars and escape PDF special delimiters (\, (, ))
  let result = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    const ch = input[i];
    if (ch === '\\' || ch === '(' || ch === ')') {
      result += `\\${ch}`;
    } else if (code >= 32 && code <= 126) {
      result += ch;
    } else if (code >= 160 && code <= 255) {
      // Octal escape for WinAnsi / ISO-8859-1 accented Portuguese characters
      result += `\\${code.toString(8).padStart(3, '0')}`;
    } else {
      result += ' ';
    }
  }
  return result;
}

/**
 * Generates a valid, self-contained PDF 1.4 binary document with the Test Run summary and items.
 */
export function generateTestRunPdfBytes(run: TestRun, items: TestRunItem[]): Uint8Array {
  const total = items.length;
  const passed = items.filter((i) => i.status === 'Passou').length;
  const failed = items.filter((i) => i.status === 'Falhou').length;
  const blocked = items.filter((i) => i.status === 'Bloqueado').length;
  const skipped = items.filter((i) => i.status === 'Pulado').length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const textLines: Array<{ text: string; size: number; bold?: boolean }> = [
    { text: `QA Board - Relatório de Execução de Testes`, size: 16, bold: true },
    { text: `Execução: ${run.name}`, size: 13, bold: true },
    {
      text: `Build: ${run.build_version || 'N/A'}   |   Ambiente: ${run.environment || 'N/A'}   |   Data: ${new Date(run.created_at).toLocaleDateString('pt-BR')}`,
      size: 10,
    },
    {
      text: '--------------------------------------------------------------------------------',
      size: 10,
    },
    {
      text: `Resumo: Total=${total} | Passou=${passed} (${passRate}%) | Falhou=${failed} | Bloqueado=${blocked} | Pulado=${skipped}`,
      size: 11,
      bold: true,
    },
    {
      text: '--------------------------------------------------------------------------------',
      size: 10,
    },
    { text: 'Casos de Teste Executados:', size: 12, bold: true },
  ];

  items.forEach((item, index) => {
    textLines.push({
      text: `${index + 1}. [${item.status.toUpperCase()}] ${item.title} (${item.module || 'Geral'} - ${item.priority})`,
      size: 10,
      bold: item.status === 'Falhou',
    });
    if (item.notes && item.notes.trim()) {
      textLines.push({
        text: `   Obs: ${item.notes.replace(/\r?\n/g, ' ').slice(0, 95)}`,
        size: 9,
      });
    }
  });

  // Build PDF content stream
  const streamCommands: string[] = ['BT'];
  let y = 790;
  streamCommands.push(`45 ${y} Td`);

  for (const line of textLines) {
    if (y < 60) break; // Keep within single page bounds cleanly
    const fontName = line.bold ? '/F2' : '/F1';
    const leading = line.size + 6;
    streamCommands.push(`${fontName} ${line.size} Tf`);
    streamCommands.push(`(${escapePdfText(line.text)}) Tj`);
    streamCommands.push(`0 -${leading} Td`);
    y -= leading;
  }
  streamCommands.push('ET');
  const contentStream = streamCommands.join('\n');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
    `6 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const encoder = new TextEncoder();
  return encoder.encode(pdf);
}

// ============================================================================
// 3. Valid CPF / CNPJ & QA Test Data Generators (Local & Deterministic Modulo 11)
// ============================================================================
function randomDigit(): number {
  return Math.floor(Math.random() * 10);
}

export function generateValidCpf(formatted = true): string {
  const digits: number[] = Array.from({ length: 9 }, () => randomDigit());
  // Avoid all-equal digits
  if (digits.every((d) => d === digits[0])) {
    digits[8] = (digits[0] + 1) % 10;
  }

  // First check digit
  let sum1 = 0;
  for (let i = 0; i < 9; i++) {
    sum1 += digits[i] * (10 - i);
  }
  const rem1 = (sum1 * 10) % 11;
  const d1 = rem1 === 10 || rem1 === 11 ? 0 : rem1;
  digits.push(d1);

  // Second check digit
  let sum2 = 0;
  for (let i = 0; i < 10; i++) {
    sum2 += digits[i] * (11 - i);
  }
  const rem2 = (sum2 * 10) % 11;
  const d2 = rem2 === 10 || rem2 === 11 ? 0 : rem2;
  digits.push(d2);

  const raw = digits.join('');
  if (!formatted) return raw;
  return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9, 11)}`;
}

export function isValidCpf(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11 || /^(\d)\1{10}$/.test(clean)) return false;
  const nums = clean.split('').map(Number);

  let sum1 = 0;
  for (let i = 0; i < 9; i++) sum1 += nums[i] * (10 - i);
  let r1 = (sum1 * 10) % 11;
  if (r1 === 10 || r1 === 11) r1 = 0;
  if (r1 !== nums[9]) return false;

  let sum2 = 0;
  for (let i = 0; i < 10; i++) sum2 += nums[i] * (11 - i);
  let r2 = (sum2 * 10) % 11;
  if (r2 === 10 || r2 === 11) r2 = 0;
  return r2 === nums[10];
}

export function generateValidCnpj(formatted = true): string {
  const digits: number[] = [
    randomDigit(),
    randomDigit(),
    randomDigit(),
    randomDigit(),
    randomDigit(),
    randomDigit(),
    randomDigit(),
    randomDigit(),
    0,
    0,
    0,
    1,
  ];

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum1 = 0;
  for (let i = 0; i < 12; i++) sum1 += digits[i] * weights1[i];
  const rem1 = sum1 % 11;
  const d1 = rem1 < 2 ? 0 : 11 - rem1;
  digits.push(d1);

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum2 = 0;
  for (let i = 0; i < 13; i++) sum2 += digits[i] * weights2[i];
  const rem2 = sum2 % 11;
  const d2 = rem2 < 2 ? 0 : 11 - rem2;
  digits.push(d2);

  const raw = digits.join('');
  if (!formatted) return raw;
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12, 14)}`;
}

export function isValidCnpj(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14 || /^(\d)\1{13}$/.test(clean)) return false;
  const nums = clean.split('').map(Number);

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum1 = 0;
  for (let i = 0; i < 12; i++) sum1 += nums[i] * weights1[i];
  const rem1 = sum1 % 11;
  const d1 = rem1 < 2 ? 0 : 11 - rem1;
  if (d1 !== nums[12]) return false;

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum2 = 0;
  for (let i = 0; i < 13; i++) sum2 += nums[i] * weights2[i];
  const rem2 = sum2 % 11;
  const d2 = rem2 < 2 ? 0 : 11 - rem2;
  return d2 === nums[13];
}

export function generateQaEmail(): string {
  const suffix = Math.random().toString(36).substring(2, 8);
  return `qa.teste+${suffix}@exemplo.local`;
}

export function generateUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
