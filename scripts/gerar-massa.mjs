#!/usr/bin/env node
/**
 * Gerador de Massas de Dados de Teste (Seed) para o QA Board
 *
 * Produz pacotes de backup (.zip contendo backup.json + attachments/) compatíveis
 * com a função "Importar Backup (.zip)" do aplicativo:
 *   1. massa-pequena.zip (~15 bugs, ~20 casos de teste, 3 checklists, 4 runs, 3 sessões, 5 snippets)
 *   2. massa-grande.zip (~1.000 bugs, ~500 casos de teste, ~30 runs para teste de performance)
 *   3. massa-malformada.zip + subpasta test-data/malformados/*.zip (casos inválidos e maliciosos)
 *
 * Uso:
 *   node scripts/gerar-massa.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'test-data');
const MALFORMED_DIR = path.join(OUTPUT_DIR, 'malformados');

// ============================================================================
// Utilitários de CRC32, Geração de PNG Sintético e Empacotador ZIP Nativo
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Gera uma imagem PNG válida (48x48 pixels) em memória, sem dependências externas
 * e livre de direitos autorais, com padrão visual colorido para teste de miniaturas e zoom.
 */
function generateSyntheticPngBuffer(r, g, b, accentR = 255, accentG = 255, accentB = 255) {
  const width = 48;
  const height = 48;

  // Cada linha do PNG possui 1 byte de filtro (0 = None) + width * 3 bytes (RGB)
  const rawScanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    rawScanlines[rowStart] = 0; // Filter type 0
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      const isBorder = x < 3 || x >= width - 3 || y < 3 || y >= height - 3;
      const isCross = Math.abs(x - y) <= 2 || Math.abs(x + y - (width - 1)) <= 2;
      if (isBorder || isCross) {
        rawScanlines[px] = accentR;
        rawScanlines[px + 1] = accentG;
        rawScanlines[px + 2] = accentB;
      } else {
        rawScanlines[px] = r;
        rawScanlines[px + 1] = g;
        rawScanlines[px + 2] = b;
      }
    }
  }

  function makeChunk(typeStr, dataBuf) {
    const typeBuf = Buffer.from(typeStr, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(dataBuf.length, 0);
    const crcInput = Buffer.concat([typeBuf, dataBuf]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenBuf, typeBuf, dataBuf, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 2; // color type 2 (Truecolor RGB)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idatData = zlib.deflateSync(rawScanlines);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Cria um arquivo .zip padrão compatível com a crate `zip` do Rust.
 * @param {Array<{ name: string, data: Buffer | string }>} entries
 * @returns {Buffer}
 */
export function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressedData = zlib.deflateRawSync(rawData);
    const entryCrc = crc32(rawData);

    // Local file header (30 bytes + file name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // general purpose bit flag (UTF-8)
    localHeader.writeUInt16LE(8, 8); // compression method: 8 (Deflate)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x554a, 12); // mod date
    localHeader.writeUInt32LE(entryCrc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, compressedData);

    // Central directory file header (46 bytes + file name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // compression method: Deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x554a, 14);
    centralHeader.writeUInt32LE(entryCrc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressedData.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

// ============================================================================
// Colunas Padrão do Kanban (Seguindo exatamente DEFAULT_BOARD_COLUMNS)
// ============================================================================
const BASE_TIMESTAMP = '2026-10-18T12:00:00.000Z';

function buildDefaultColumns() {
  return [
    {
      id: 'col-new',
      name: 'Novo',
      position: 0,
      is_done_column: false,
      created_at: BASE_TIMESTAMP,
    },
    {
      id: 'col-analysis',
      name: 'Em análise',
      position: 1,
      is_done_column: false,
      created_at: BASE_TIMESTAMP,
    },
    {
      id: 'col-reported',
      name: 'Reportado',
      position: 2,
      is_done_column: false,
      created_at: BASE_TIMESTAMP,
    },
    {
      id: 'col-waiting-fix',
      name: 'Aguardando fix',
      position: 3,
      is_done_column: false,
      created_at: BASE_TIMESTAMP,
    },
    {
      id: 'col-retest',
      name: 'Reteste',
      position: 4,
      is_done_column: false,
      created_at: BASE_TIMESTAMP,
    },
    {
      id: 'col-closed',
      name: 'Fechado',
      position: 5,
      is_done_column: true,
      created_at: BASE_TIMESTAMP,
    },
  ];
}

// ============================================================================
// Construção da MASSA PEQUENA (15 bugs, 20 casos, 3 checklists, 4 runs, 3 sessões, 5 snippets)
// ============================================================================
export function generateSmallSeedPackage() {
  const columns = buildDefaultColumns();
  const longText5500 =
    'LOG DETALHADO DE STACKTRACE E PAYLOAD DE REPRODUÇÃO:\n' +
    '[2026-10-18 11:42:09.128] ERROR br.com.qaboard.checkout.PaymentGatewayService - Falha crítica na transação PIX.\n'.repeat(
      52,
    ) +
    '\nFIM DO LOG DE 5.000+ CARACTERES.';

  // 20 Casos de Teste cobrindo múltiplos módulos e prioridades
  const modules = [
    'Checkout',
    'Autenticação',
    'Pagamentos PIX',
    'Catálogo',
    'Relatórios',
    'Notificações',
    'API Gateway',
    'Mobile App',
  ];
  const priorities = ['P1 - Urgente', 'P2 - Alta', 'P3 - Média', 'P4 - Baixa'];
  const severities = ['Crítica', 'Alta', 'Média', 'Baixa'];

  const testCases = Array.from({ length: 20 }, (_, i) => {
    const idx = i + 1;
    const mod = modules[i % modules.length];
    const pri = priorities[i % priorities.length];
    return {
      id: `tc-seed-${String(idx).padStart(2, '0')}`,
      title: `CT-${String(idx).padStart(2, '0')} — Validar fluxo de ${mod} (Cenário #${idx} com acentuação çãõéí)`,
      module: mod,
      tags: [
        i < 6 ? 'smoke' : 'regressao',
        mod.toLowerCase().replace(/\s+/g, '-'),
        idx % 3 === 0 ? 'critico' : ' funcional',
      ],
      preconditions: `Usuário autenticado no ambiente de Homologação com permissão para o módulo ${mod}.`,
      steps: `1. Acessar a tela principal de ${mod}\n2. Preencher os dados obrigatórios do cenário #${idx}\n3. Acionar o botão de confirmação e inspecionar resposta HTTP.`,
      expected_result: `O sistema processa a requisição no módulo ${mod} com código HTTP 200 e exibe mensagem de confirmação.`,
      priority: pri,
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    };
  });

  // 3 Checklists (Smoke, Regressão, Pré-Release)
  const checklists = [
    {
      id: 'chk-smoke',
      name: 'Checklist Smoke Test',
      category: 'Smoke',
      description: 'Validação rápida dos fluxos vitais logo após deploy da build.',
      test_case_ids: testCases.slice(0, 6).map((tc) => tc.id),
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
    {
      id: 'chk-regression',
      name: 'Suíte de Regressão Principal',
      category: 'Regressão',
      description: 'Bateria completa de regressão cobrindo todos os módulos centrais.',
      test_case_ids: testCases.slice(0, 14).map((tc) => tc.id),
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
    {
      id: 'chk-prerelease',
      name: 'Checklist Pré-Release',
      category: 'Pré-Release',
      description: 'Verificações finais de sanidade, segurança e integrações antes de Produção.',
      test_case_ids: testCases.slice(12, 20).map((tc) => tc.id),
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
  ];

  // 3 Sessões Exploratórias
  const exploratorySessions = [
    {
      id: 'exp-seed-01',
      charter:
        'Explorar concorrência e duplo clique no fechamento de pedido com PIX e cupom expirado 🧪',
      environment: 'Homologação',
      build_version: 'v2.4.0',
      module: 'Pagamentos PIX',
      notes:
        'Ao clicar 5x rapidamente em "Gerar QR Code", duas cobranças distintas foram abertas no banco.\nTestado também com payload `<script>alert(1)</script>` no campo de observação do pedido.',
      duration_seconds: 2745,
      created_at: '2026-10-16T14:00:00.000Z',
      updated_at: '2026-10-16T14:45:45.000Z',
    },
    {
      id: 'exp-seed-02',
      charter:
        'Testar limites de upload, nomes com emojis 🔥 e SQL Injection em filtros do Catálogo',
      environment: 'Staging',
      build_version: 'v2.4.1',
      module: 'Catálogo',
      notes:
        "Busca com string `'; DROP TABLE bugs;--` retornou erro 500 quando combinada com aspas duplas `\"teste\"`.",
      duration_seconds: 1820,
      created_at: '2026-10-17T10:00:00.000Z',
      updated_at: '2026-10-17T10:30:20.000Z',
    },
    {
      id: 'exp-seed-03',
      charter: 'Validar expiração de sessão OAuth e reconexão automática em rede instável',
      environment: 'QA-Interno',
      build_version: 'v2.5.0-rc1',
      module: 'Autenticação',
      notes: 'Token renovado corretamente após 15 minutos, porém tela pisca em modo claro.',
      duration_seconds: 950,
      created_at: '2026-10-18T09:00:00.000Z',
      updated_at: '2026-10-18T09:15:50.000Z',
    },
  ];

  // 4 Test Runs:
  // Run 1: Todos Passou (v2.3.0)
  // Run 2: Todos Falhou (v2.4.0)
  // Run 3: Misto - Passou, Falhou, Bloqueado, Pulado (v2.4.1)
  // Run 4: Misto com Pendente (v2.5.0-rc1)
  const testRuns = [
    {
      id: 'run-seed-all-pass',
      name: 'Smoke Test v2.3.0 (100% Aprovado)',
      build_version: 'v2.3.0',
      environment: 'Homologação',
      checklist_id: 'chk-smoke',
      created_at: '2026-10-15T10:00:00.000Z',
      updated_at: '2026-10-15T11:00:00.000Z',
    },
    {
      id: 'run-seed-all-fail',
      name: 'Bateria Crítica Gateway v2.4.0 (100% Falha)',
      build_version: 'v2.4.0',
      environment: 'Staging',
      checklist_id: 'chk-smoke',
      created_at: '2026-10-16T15:00:00.000Z',
      updated_at: '2026-10-16T16:30:00.000Z',
    },
    {
      id: 'run-seed-mixed',
      name: 'Regressão Completa v2.4.1 (Resultado Misto)',
      build_version: 'v2.4.1',
      environment: 'Homologação',
      checklist_id: 'chk-regression',
      created_at: '2026-10-17T14:00:00.000Z',
      updated_at: '2026-10-17T17:00:00.000Z',
    },
    {
      id: 'run-seed-prerelease',
      name: 'Pré-Release Candidate v2.5.0-rc1 (Em Execução)',
      build_version: 'v2.5.0-rc1',
      environment: 'Pré-Produção',
      checklist_id: 'chk-prerelease',
      created_at: '2026-10-18T11:00:00.000Z',
      updated_at: '2026-10-18T12:00:00.000Z',
    },
  ];

  const testRunItems = [];

  // Itens da Run 1 (Todos Passou)
  testCases.slice(0, 5).forEach((tc, idx) => {
    testRunItems.push({
      id: `runitem-pass-${idx + 1}`,
      run_id: 'run-seed-all-pass',
      test_case_id: tc.id,
      title: tc.title,
      module: tc.module,
      priority: tc.priority,
      preconditions: tc.preconditions,
      steps: tc.steps,
      expected_result: tc.expected_result,
      status: 'Passou',
      notes: 'Fluxo validado com sucesso sem erros no console.',
      created_bug_id: null,
      executed_at: '2026-10-15T10:45:00.000Z',
    });
  });

  // Itens da Run 2 (Todos Falhou)
  testCases.slice(0, 5).forEach((tc, idx) => {
    testRunItems.push({
      id: `runitem-fail-${idx + 1}`,
      run_id: 'run-seed-all-fail',
      test_case_id: tc.id,
      title: tc.title,
      module: tc.module,
      priority: tc.priority,
      preconditions: tc.preconditions,
      steps: tc.steps,
      expected_result: tc.expected_result,
      status: 'Falhou',
      notes: `Falha reproduzida na build v2.4.0: serviço retornou HTTP 502 Bad Gateway no passo 3.`,
      created_bug_id: idx === 0 ? 'bug-seed-01' : null,
      executed_at: '2026-10-16T16:10:00.000Z',
    });
  });

  // Itens da Run 3 (Misto: Passou, Falhou, Bloqueado, Pulado)
  const mixedStatuses = [
    'Passou',
    'Passou',
    'Falhou',
    'Falhou',
    'Bloqueado',
    'Pulado',
    'Passou',
    'Passou',
  ];
  testCases.slice(0, 8).forEach((tc, idx) => {
    const st = mixedStatuses[idx];
    testRunItems.push({
      id: `runitem-mixed-${idx + 1}`,
      run_id: 'run-seed-mixed',
      test_case_id: tc.id,
      title: tc.title,
      module: tc.module,
      priority: tc.priority,
      preconditions: tc.preconditions,
      steps: tc.steps,
      expected_result: tc.expected_result,
      status: st,
      notes:
        st === 'Falhou'
          ? 'Divergência no cálculo de impostos ICMS-ST.'
          : st === 'Bloqueado'
            ? 'Bloqueado aguardando certificado digital no servidor de Homologação.'
            : st === 'Pulado'
              ? 'Pulado nesta janela de teste por escopo reduzido.'
              : 'OK.',
      created_bug_id: idx === 2 ? 'bug-seed-02' : null,
      executed_at: '2026-10-17T16:20:00.000Z',
    });
  });

  // Itens da Run 4 (Em andamento: Passou, Falhou, Pendente)
  const rcStatuses = ['Passou', 'Passou', 'Falhou', 'Pendente', 'Pendente', 'Pendente'];
  testCases.slice(12, 18).forEach((tc, idx) => {
    const st = rcStatuses[idx];
    testRunItems.push({
      id: `runitem-rc-${idx + 1}`,
      run_id: 'run-seed-prerelease',
      test_case_id: tc.id,
      title: tc.title,
      module: tc.module,
      priority: tc.priority,
      preconditions: tc.preconditions,
      steps: tc.steps,
      expected_result: tc.expected_result,
      status: st,
      notes: st === 'Pendente' ? '' : `Executado na RC1 (${st}).`,
      created_bug_id: null,
      executed_at: st === 'Pendente' ? null : '2026-10-18T11:50:00.000Z',
    });
  });

  // 15 Bugs cobrindo todas as 6 colunas, 4 severidades, P1-P4, reabertos, XSS/SQLi, texto 5000+ chars,
  // vínculos Jira e Azure DevOps, 0 anexos, 1 anexo e 10 anexos.
  const builds = ['v2.3.0', 'v2.4.0', 'v2.4.1', 'v2.5.0-rc1'];
  const bugSpecs = [
    {
      id: 'bug-seed-01',
      column_id: 'col-new',
      title: '🚨 [Crítico] Duplicidade de cobrança PIX ao clicar duas vezes em "Pagar Agora" 🔥',
      severity: 'Crítica',
      priority: 'P1 - Urgente',
      environment: 'Homologação',
      build_version: 'v2.4.0',
      module: 'Pagamentos PIX',
      tags: ['pix', 'duplicidade', 'concorrencia', 'test-run'],
      steps_to_reproduce:
        '1. Adicionar item ao carrinho\n2. Selecionar PIX\n3. Dar duplo clique rápido em "Pagar Agora"',
      expected_result: 'O botão deve ser desabilitado no primeiro clique e gerar apenas 1 transação.',
      actual_result: 'Duas transações PIX ativas são geradas para o mesmo pedido.',
      external_ticket_url: 'http://localhost:8787/browse/QA-101',
      external_ticket_key: 'QA-101',
      external_provider: 'jira',
      external_status: 'To Do',
      reopened_count: 2,
      test_run_item_id: 'runitem-fail-1',
      exploratory_session_id: 'exp-seed-01',
    },
    {
      id: 'bug-seed-02',
      column_id: 'col-new',
      title: 'XSS refletido e SQL Injection no filtro: `<script>alert(1)</script>` e `\'; DROP TABLE bugs;--`',
      severity: 'Crítica',
      priority: 'P1 - Urgente',
      environment: 'Staging',
      build_version: 'v2.4.1',
      module: 'Catálogo',
      tags: ['seguranca', 'xss', 'sqli', 'aspas'],
      steps_to_reproduce:
        '1. Ir na busca de produtos\n2. Digitar `<script>alert("XSS")</script>` ou `\'; DROP TABLE bugs;--`\n3. Pressionar Enter com aspas \'simples\' e "duplas".',
      expected_result: 'A entrada deve ser escapada como texto puro sem quebrar a query SQL.',
      actual_result: 'Retorna erro 500 com fragmento da query SQL exposto no corpo da resposta.',
      external_ticket_url: 'http://localhost:8787/ado/org/proj/_workitems/edit/5001',
      external_ticket_key: '5001',
      external_provider: 'azure_devops',
      external_status: 'New',
      reopened_count: 0,
      test_run_item_id: 'runitem-mixed-3',
      exploratory_session_id: 'exp-seed-02',
    },
    {
      id: 'bug-seed-03',
      column_id: 'col-analysis',
      title: 'Card com 10 anexos de evidência e stacktrace longo (5.000+ caracteres) para teste de UI',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: 'Homologação',
      build_version: 'v2.4.1',
      module: 'API Gateway',
      tags: ['10-anexos', 'stacktrace-longo', 'performance'],
      steps_to_reproduce: longText5500,
      expected_result: 'O modal deve exibir rolagem suave mesmo com mais de 5.000 caracteres e 10 anexos.',
      actual_result: longText5500,
      external_ticket_url: 'http://localhost:8787/browse/QA-102',
      external_ticket_key: 'QA-102',
      external_provider: 'jira',
      external_status: 'In Progress',
      reopened_count: 1,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-04',
      column_id: 'col-analysis',
      title: 'Cálculo incorreto de frete expresso para CEPs da Zona Franca de Manaus (Acentuação: São Luís / Amapá)',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: 'Homologação',
      build_version: 'v2.4.0',
      module: 'Checkout',
      tags: ['frete', 'impostos', 'manaus'],
      steps_to_reproduce: '1. Informar CEP 69000-000\n2. Selecionar entrega expressa',
      expected_result: 'Aplicar isenção tributária configurada para a região.',
      actual_result: 'Valor do frete triplica indevidamente.',
      external_ticket_url: '',
      external_ticket_key: '',
      external_provider: '',
      external_status: '',
      reopened_count: 0,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-05',
      column_id: 'col-reported',
      title: 'Exportação de relatório CSV corrompe caracteres UTF-8 (ç, ã, õ, é, ü) no Excel Windows',
      severity: 'Média',
      priority: 'P3 - Média',
      environment: 'Homologação',
      build_version: 'v2.3.0',
      module: 'Relatórios',
      tags: ['csv', 'utf8', 'exportacao'],
      steps_to_reproduce: '1. Exportar lista de clientes\n2. Abrir no Excel',
      expected_result: 'Arquivo deve incluir BOM UTF-8 para leitura correta.',
      actual_result: 'Nomes como "João Conceição" aparecem truncados.',
      external_ticket_url: 'http://localhost:8787/browse/QA-103',
      external_ticket_key: 'QA-103',
      external_provider: 'jira',
      external_status: 'Open',
      reopened_count: 0,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-06',
      column_id: 'col-reported',
      title: 'Push notification de pedido enviado não abre a tela de detalhes no Android 14 📱',
      severity: 'Média',
      priority: 'P2 - Alta',
      environment: 'Staging',
      build_version: 'v2.4.1',
      module: 'Mobile App',
      tags: ['mobile', 'android', 'push'],
      steps_to_reproduce: '1. Receber push notification\n2. Tocar na notificação com o app em background',
      expected_result: 'Direcionar para /pedidos/:id.',
      actual_result: 'Abre apenas a home page sem navegar para o pedido.',
      external_ticket_url: 'http://localhost:8787/ado/org/proj/_workitems/edit/5002',
      external_ticket_key: '5002',
      external_provider: 'azure_devops',
      external_status: 'Active',
      reopened_count: 0,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-07',
      column_id: 'col-waiting-fix',
      title: 'Timeout de 30s ao consultar histórico anual de faturamento com mais de 50 mil notas',
      severity: 'Alta',
      priority: 'P1 - Urgente',
      environment: 'Pré-Produção',
      build_version: 'v2.5.0-rc1',
      module: 'Relatórios',
      tags: ['timeout', 'banco-de-dados', 'performance'],
      steps_to_reproduce: '1. Filtrar período de 01/01 a 31/12\n2. Clicar em Pesquisar',
      expected_result: 'Consulta paginada em até 2 segundos.',
      actual_result: 'Gateway retorna 504 Gateway Timeout após 30 segundos.',
      external_ticket_url: 'http://localhost:8787/browse/QA-104',
      external_ticket_key: 'QA-104',
      external_provider: 'jira',
      external_status: 'In Progress',
      reopened_count: 3,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-08',
      column_id: 'col-waiting-fix',
      title: 'Token JWT não é invalidado no servidor após troca de senha pelo usuário',
      severity: 'Crítica',
      priority: 'P1 - Urgente',
      environment: 'Homologação',
      build_version: 'v2.4.0',
      module: 'Autenticação',
      tags: ['seguranca', 'jwt', 'sessao'],
      steps_to_reproduce: '1. Copiar token na aba A\n2. Trocar senha na aba B\n3. Chamar API usando token antigo',
      expected_result: 'API deve recusar com 401 Unauthorized.',
      actual_result: 'Token antigo continua aceito até expirar.',
      external_ticket_url: '',
      external_ticket_key: '',
      external_provider: '',
      external_status: '',
      reopened_count: 1,
      test_run_item_id: null,
      exploratory_session_id: 'exp-seed-03',
    },
    {
      id: 'bug-seed-09',
      column_id: 'col-retest',
      title: 'Desalinhamento do modal de confirmação de exclusão em resolução 1366x768',
      severity: 'Baixa',
      priority: 'P4 - Baixa',
      environment: 'Homologação',
      build_version: 'v2.4.1',
      module: 'Catálogo',
      tags: ['ui', 'css', 'responsividade'],
      steps_to_reproduce: '1. Redimensionar janela para 1366x768\n2. Abrir modal de exclusão',
      expected_result: 'Botões visíveis e alinhados à direita.',
      actual_result: 'Botão Confirmar corta na borda inferior.',
      external_ticket_url: 'http://localhost:8787/browse/QA-105',
      external_ticket_key: 'QA-105',
      external_provider: 'jira',
      external_status: 'Ready for QA',
      reopened_count: 0,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-10',
      column_id: 'col-retest',
      title: 'E-mail de recuperação de senha enviado em duplicidade quando fila SMTP atrasa',
      severity: 'Média',
      priority: 'P3 - Média',
      environment: 'Staging',
      build_version: 'v2.5.0-rc1',
      module: 'Notificações',
      tags: ['email', 'smtp', 'fila'],
      steps_to_reproduce: '1. Solicitar redefinição de senha\n2. Verificar caixa de entrada',
      expected_result: 'Apenas 1 e-mail enviado com código de 6 dígitos.',
      actual_result: 'Dois e-mails chegam com tokens diferentes invalidando o primeiro.',
      external_ticket_url: 'http://localhost:8787/ado/org/proj/_workitems/edit/5003',
      external_ticket_key: '5003',
      external_provider: 'azure_devops',
      external_status: 'Resolved',
      reopened_count: 2,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-11',
      column_id: 'col-retest',
      title: 'Filtro de pedidos por CNPJ com máscara (00.000.000/0001-91) retorna lista vazia',
      severity: 'Média',
      priority: 'P2 - Alta',
      environment: 'Homologação',
      build_version: 'v2.4.1',
      module: 'Checkout',
      tags: ['cnpj', 'mascara', 'filtro'],
      steps_to_reproduce: '1. Colar CNPJ formatado com pontos, barra e traço\n2. Pesquisar',
      expected_result: 'Sistema deve limpar pontuação antes de consultar o banco.',
      actual_result: 'Nenhum registro encontrado.',
      external_ticket_url: '',
      external_ticket_key: '',
      external_provider: '',
      external_status: '',
      reopened_count: 0,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-12',
      column_id: 'col-closed',
      title: 'Texto de ajuda com erro de digitação na tela de boas-vindas ("Cadatro" em vez de "Cadastro")',
      severity: 'Baixa',
      priority: 'P4 - Baixa',
      environment: 'Homologação',
      build_version: 'v2.3.0',
      module: 'Autenticação',
      tags: ['texto', 'typo', 'ux'],
      steps_to_reproduce: '1. Abrir tela inicial de login\n2. Observar subtítulo',
      expected_result: 'Exibir "Cadastro de Analista".',
      actual_result: 'Exibia "Cadatro de Analista".',
      external_ticket_url: 'http://localhost:8787/browse/QA-106',
      external_ticket_key: 'QA-106',
      external_provider: 'jira',
      external_status: 'Done',
      reopened_count: 0,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-13',
      column_id: 'col-closed',
      title: 'Botão "Limpar Filtros" não resetava o seletor de Severidade no Safari/WebView',
      severity: 'Baixa',
      priority: 'P3 - Média',
      environment: 'Homologação',
      build_version: 'v2.3.0',
      module: 'Catálogo',
      tags: ['filtros', 'frontend'],
      steps_to_reproduce: '1. Selecionar severidade Alta\n2. Clicar em Limpar',
      expected_result: 'Todos os seletores voltam para "Todos".',
      actual_result: 'Corrigido na v2.3.0.',
      external_ticket_url: 'http://localhost:8787/ado/org/proj/_workitems/edit/5004',
      external_ticket_key: '5004',
      external_provider: 'azure_devops',
      external_status: 'Closed',
      reopened_count: 1,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-14',
      column_id: 'col-closed',
      title: 'Rate limit da API de CEP retornava 500 em vez de 429 Too Many Requests',
      severity: 'Média',
      priority: 'P3 - Média',
      environment: 'Staging',
      build_version: 'v2.4.0',
      module: 'API Gateway',
      tags: ['rate-limit', 'http-429', 'api'],
      steps_to_reproduce: '1. Disparar 100 requisições por segundo no endpoint /cep',
      expected_result: 'Retornar HTTP 429 com cabeçalho Retry-After.',
      actual_result: 'Corrigido e validado.',
      external_ticket_url: '',
      external_ticket_key: '',
      external_provider: '',
      external_status: '',
      reopened_count: 0,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
    {
      id: 'bug-seed-15',
      column_id: 'col-closed',
      title: 'Queda de conexão WebSocket ao alternar entre Wi-Fi e 5G no app mobile',
      severity: 'Alta',
      priority: 'P2 - Alta',
      environment: 'Pré-Produção',
      build_version: 'v2.5.0-rc1',
      module: 'Mobile App',
      tags: ['websocket', 'rede', 'reconexao'],
      steps_to_reproduce: '1. Desligar Wi-Fi com chat aberto\n2. Observar reconexão no 5G',
      expected_result: 'Reconectar com backoff exponencial em até 5s.',
      actual_result: 'Validado com sucesso na RC1.',
      external_ticket_url: '',
      external_ticket_key: '',
      external_provider: '',
      external_status: '',
      reopened_count: 4,
      test_run_item_id: null,
      exploratory_session_id: null,
    },
  ];

  // Calcula posição dentro de cada coluna
  const colPositions = {};
  const bugs = bugSpecs.map((b, i) => {
    const pos = colPositions[b.column_id] ?? 0;
    colPositions[b.column_id] = pos + 1;
    return {
      ...b,
      position: pos,
      created_at: new Date(Date.parse(BASE_TIMESTAMP) + i * 3600_000).toISOString(),
      updated_at: new Date(Date.parse(BASE_TIMESTAMP) + i * 3600_000 + 1800_000).toISOString(),
    };
  });

  // Anexos:
  // - bug-seed-01 tem 1 anexo (print-erro-pix.png)
  // - bug-seed-03 tem 10 anexos (evidencia-01.png a evidencia-10.png)
  // - demais bugs têm 0 anexos (cobrindo 0, 1 e 10 anexos)
  const attachments = [];
  const zipAttachmentEntries = [];

  const pngColors = [
    [220, 38, 38],
    [37, 99, 235],
    [16, 185, 129],
    [217, 119, 6],
    [124, 58, 237],
    [236, 72, 153],
    [14, 165, 233],
    [234, 88, 12],
    [22, 163, 74],
    [79, 70, 229],
  ];

  // 1 anexo para bug-seed-01
  const att1Id = 'att-seed-single';
  const att1Name = 'print_erro_pix.png';
  const att1RelPath = `attachments/${att1Id}_${att1Name}`;
  const att1Buf = generateSyntheticPngBuffer(190, 24, 93);
  attachments.push({
    id: att1Id,
    parent_type: 'bug',
    parent_id: 'bug-seed-01',
    file_name: att1Name,
    mime_type: 'image/png',
    relative_path: att1RelPath,
    size_bytes: att1Buf.length,
    created_at: BASE_TIMESTAMP,
  });
  zipAttachmentEntries.push({ name: att1RelPath, data: att1Buf });

  // 10 anexos para bug-seed-03
  for (let k = 1; k <= 10; k++) {
    const id = `att-seed-multi-${String(k).padStart(2, '0')}`;
    const fileName = `evidencia_passo_${String(k).padStart(2, '0')}.png`;
    const relativePath = `attachments/${id}_${fileName}`;
    const [r, g, b] = pngColors[(k - 1) % pngColors.length];
    const buf = generateSyntheticPngBuffer(r, g, b);

    attachments.push({
      id,
      parent_type: 'bug',
      parent_id: 'bug-seed-03',
      file_name: fileName,
      mime_type: 'image/png',
      relative_path: relativePath,
      size_bytes: buf.length,
      created_at: BASE_TIMESTAMP,
    });
    zipAttachmentEntries.push({ name: relativePath, data: buf });
  }

  // 5 Snippets cobrindo todas as categorias
  const snippets = [
    {
      id: 'snip-seed-01',
      title: 'Payload JSON — Pedido PIX com Desconto e Subitens',
      category: 'Payload JSON',
      content: JSON.stringify(
        {
          order_id: 'ORD-2026-9981',
          payment_method: 'pix',
          customer: { name: 'João Conceição', tax_id: '39053344705' },
          items: [{ sku: 'QA-PRO-01', qty: 2, price_cents: 14990 }],
        },
        null,
        2,
      ),
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
    {
      id: 'snip-seed-02',
      title: 'Query SQL — Auditar Cobranças Duplicadas nas Últimas 24h',
      category: 'Query SQL',
      content:
        'SELECT order_id, COUNT(*) AS total_charges\nFROM payment_transactions\nWHERE created_at >= datetime(\'now\', \'-1 day\')\nGROUP BY order_id\nHAVING COUNT(*) > 1;',
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
    {
      id: 'snip-seed-03',
      title: 'Massa de Dados — Strings de Borda (XSS, SQLi, Emojis e Unicode)',
      category: 'Massa de Dados',
      content:
        'XSS: <script>alert("QA")</script>\nSQLi: \'; DROP TABLE bugs;--\nEmojis: 🐛🔥🚨✅🧪💥\nAcentos: ÁÉÍÓÚ çãõ âêô àü',
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
    {
      id: 'snip-seed-04',
      title: 'Script / cURL — Disparar Criação de Issue no Mock Servidor Local',
      category: 'Script / cURL',
      content:
        'curl -X POST "http://localhost:8787/rest/api/3/issue" \\\n  -H "Authorization: Basic FAKE-TOKEN-NAO-USAR" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"fields":{"project":{"key":"QA"},"summary":"Bug via cURL","issuetype":{"name":"Bug"}}}\'',
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
    {
      id: 'snip-seed-05',
      title: 'Massa de Dados — Cartões e Chaves PIX Fictícias de Homologação',
      category: 'Massa de Dados',
      content:
        'Chave PIX Aleatória (Fake): 00000000-1111-2222-3333-444444444444\nToken Teste: FAKE-TOKEN-NAO-USAR',
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
  ];

  const payload = {
    version: 3,
    exported_at: BASE_TIMESTAMP,
    theme: 'dark',
    columns,
    bugs,
    attachments,
    test_cases: testCases,
    checklists,
    test_runs: testRuns,
    test_run_items: testRunItems,
    exploratory_sessions: exploratorySessions,
    snippets,
  };

  const zipBuffer = buildZipBuffer([
    { name: 'backup.json', data: JSON.stringify(payload, null, 2) },
    ...zipAttachmentEntries,
  ]);

  return { payload, zipBuffer };
}

// ============================================================================
// Construção da MASSA GRANDE (1.000 bugs, 500 casos de teste, 30 runs)
// ============================================================================
export function generateLargeSeedPackage() {
  const columns = buildDefaultColumns();
  const severities = ['Crítica', 'Alta', 'Média', 'Baixa'];
  const priorities = ['P1 - Urgente', 'P2 - Alta', 'P3 - Média', 'P4 - Baixa'];
  const modules = [
    'Checkout',
    'Autenticação',
    'Pagamentos PIX',
    'Catálogo',
    'Relatórios',
    'Notificações',
    'API Gateway',
    'Mobile App',
    'Faturamento',
    'Logística',
  ];
  const builds = ['v2.1.0', 'v2.2.0', 'v2.3.0', 'v2.4.0', 'v2.4.1', 'v2.5.0-rc1'];
  const environments = ['Homologação', 'Staging', 'QA-Interno', 'Pré-Produção'];

  // 500 Casos de Teste
  const testCases = Array.from({ length: 500 }, (_, i) => {
    const idx = i + 1;
    const mod = modules[i % modules.length];
    return {
      id: `tc-large-${String(idx).padStart(4, '0')}`,
      title: `CT-${String(idx).padStart(4, '0')} — Validar regra de negócio de ${mod} (#${idx})`,
      module: mod,
      tags: [i % 2 === 0 ? 'regressao' : 'smoke', mod.toLowerCase().replace(/\s+/g, '-')],
      preconditions: `Ambiente configurado para ${mod}.`,
      steps: `1. Abrir módulo ${mod}\n2. Executar operação #${idx}\n3. Conferir resultado.`,
      expected_result: `Operação #${idx} concluída com sucesso em ${mod}.`,
      priority: priorities[i % priorities.length],
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    };
  });

  // 3 Checklists
  const checklists = [
    {
      id: 'chk-smoke',
      name: 'Checklist Smoke Test (Massa Grande)',
      category: 'Smoke',
      description: '50 casos rápidos de fumaça.',
      test_case_ids: testCases.slice(0, 50).map((c) => c.id),
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
    {
      id: 'chk-regression',
      name: 'Suíte de Regressão (250 Casos)',
      category: 'Regressão',
      description: '250 casos de regressão completa.',
      test_case_ids: testCases.slice(0, 250).map((c) => c.id),
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
    {
      id: 'chk-prerelease',
      name: 'Checklist Pré-Release (100 Casos)',
      category: 'Pré-Release',
      description: '100 casos críticos pré-produção.',
      test_case_ids: testCases.slice(400, 500).map((c) => c.id),
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    },
  ];

  // 30 Test Runs (com 15 itens cada = 450 itens de execução)
  const statuses = ['Passou', 'Passou', 'Passou', 'Falhou', 'Bloqueado', 'Pulado'];
  const testRuns = [];
  const testRunItems = [];

  for (let r = 0; r < 30; r++) {
    const runNum = r + 1;
    const runId = `run-large-${String(runNum).padStart(2, '0')}`;
    const build = builds[r % builds.length];
    const env = environments[r % environments.length];

    testRuns.push({
      id: runId,
      name: `Execução Automatizada/Manual #${String(runNum).padStart(2, '0')} (${build})`,
      build_version: build,
      environment: env,
      checklist_id: checklists[r % checklists.length].id,
      created_at: new Date(Date.parse(BASE_TIMESTAMP) + r * 3600_000).toISOString(),
      updated_at: new Date(Date.parse(BASE_TIMESTAMP) + r * 3600_000 + 1200_000).toISOString(),
    });

    for (let j = 0; j < 15; j++) {
      const tc = testCases[(r * 15 + j) % testCases.length];
      const status = statuses[(r + j) % statuses.length];
      testRunItems.push({
        id: `runitem-large-${runNum}-${j + 1}`,
        run_id: runId,
        test_case_id: tc.id,
        title: tc.title,
        module: tc.module,
        priority: tc.priority,
        preconditions: tc.preconditions,
        steps: tc.steps,
        expected_result: tc.expected_result,
        status,
        notes: status === 'Falhou' ? `Falha detectada na build ${build}` : 'Verificado.',
        created_bug_id: null,
        executed_at: BASE_TIMESTAMP,
      });
    }
  }

  // 1.000 Bugs distribuídos nas 6 colunas
  const colPositions = {};
  const bugs = Array.from({ length: 1000 }, (_, i) => {
    const idx = i + 1;
    const col = columns[i % columns.length];
    const pos = colPositions[col.id] ?? 0;
    colPositions[col.id] = pos + 1;

    const sev = severities[i % severities.length];
    const pri = priorities[i % priorities.length];
    const mod = modules[i % modules.length];
    const build = builds[i % builds.length];
    const env = environments[i % environments.length];
    const isJira = i % 10 === 0;
    const isAdo = i % 15 === 0 && !isJira;

    return {
      id: `bug-large-${String(idx).padStart(4, '0')}`,
      column_id: col.id,
      position: pos,
      title: `BUG-${String(idx).padStart(4, '0')} — Falha em ${mod} na build ${build} (${sev})`,
      severity: sev,
      priority: pri,
      environment: env,
      build_version: build,
      module: mod,
      tags: [
        mod.toLowerCase().replace(/\s+/g, '-'),
        build,
        sev.toLowerCase(),
        idx % 7 === 0 ? 'regressao' : 'funcional',
      ],
      steps_to_reproduce: `1. Acessar ${mod} no ambiente ${env}\n2. Executar fluxo de teste #${idx}\n3. Observar falha.`,
      expected_result: `Comportamento esperado conforme especificação do módulo ${mod}.`,
      actual_result: `Comportamento incorreto registrado no card #${idx} durante testes na versão ${build}.`,
      external_ticket_url: isJira
        ? `http://localhost:8787/browse/QA-${1000 + idx}`
        : isAdo
          ? `http://localhost:8787/ado/org/proj/_workitems/edit/${8000 + idx}`
          : '',
      external_ticket_key: isJira ? `QA-${1000 + idx}` : isAdo ? String(8000 + idx) : '',
      external_provider: isJira ? 'jira' : isAdo ? 'azure_devops' : '',
      external_status: isJira ? 'In Progress' : isAdo ? 'Active' : '',
      reopened_count: idx % 8 === 0 ? (idx % 3) + 1 : 0,
      test_run_item_id: null,
      exploratory_session_id: null,
      created_at: BASE_TIMESTAMP,
      updated_at: BASE_TIMESTAMP,
    };
  });

  const payload = {
    version: 3,
    exported_at: BASE_TIMESTAMP,
    theme: 'dark',
    columns,
    bugs,
    attachments: [],
    test_cases: testCases,
    checklists,
    test_runs: testRuns,
    test_run_items: testRunItems,
    exploratory_sessions: [],
    snippets: [],
  };

  const zipBuffer = buildZipBuffer([
    { name: 'backup.json', data: JSON.stringify(payload) },
  ]);

  return { payload, zipBuffer };
}

// ============================================================================
// Construção dos Pacotes Malformados (massa-malformada.zip + 6 cenários individuais)
// ============================================================================
export function generateMalformedSeedPackages() {
  const columns = buildDefaultColumns();

  // 1. ZIP corrompido (bytes truncados que não formam um arquivo ZIP válido)
  const corruptedZipBuffer = Buffer.from(
    'PK\x03\x04CORRUPTED_ZIP_DATA_NAO_EH_UM_ARQUIVO_ZIP_VALIDO_000000',
    'utf8',
  );

  // 2. backup.json com sintaxe JSON inválida
  const invalidJsonZipBuffer = buildZipBuffer([
    {
      name: 'backup.json',
      data: '{ "version": 3, "columns": [ { "id": "col-new", JSON_QUEBRADO_AQUI ',
    },
  ]);

  // 3. Campo obrigatório faltando (bug sem `title` e sem `column_id`)
  const missingFieldZipBuffer = buildZipBuffer([
    {
      name: 'backup.json',
      data: JSON.stringify({
        version: 3,
        exported_at: BASE_TIMESTAMP,
        columns,
        bugs: [{ id: 'bug-invalido-sem-titulo-e-coluna', position: 0 }],
        attachments: [],
      }),
    },
  ]);

  // 4. Entrada com caminho `../../fora.txt` (Tentativa de Zip Slip / Path Traversal)
  const zipSlipBuffer = buildZipBuffer([
    {
      name: 'backup.json',
      data: JSON.stringify({
        version: 3,
        exported_at: BASE_TIMESTAMP,
        columns,
        bugs: [],
        attachments: [],
      }),
    },
    {
      name: '../../fora.txt',
      data: 'TENTATIVA_DE_ESCRITA_FORA_DA_PASTA_DO_APP_ZIP_SLIP',
    },
  ]);

  // 5. Anexo referenciado no backup.json cujo arquivo não existe dentro do pacote ZIP
  const missingAttachmentZipBuffer = buildZipBuffer([
    {
      name: 'backup.json',
      data: JSON.stringify({
        version: 3,
        exported_at: BASE_TIMESTAMP,
        columns,
        bugs: [
          {
            id: 'bug-anexo-fantasma',
            column_id: 'col-new',
            position: 0,
            title: 'Bug apontando para anexo ausente no ZIP',
            severity: 'Alta',
            priority: 'P2 - Alta',
            environment: 'Homologação',
            build_version: 'v2.4.0',
            module: 'Checkout',
            tags: [],
            steps_to_reproduce: '',
            expected_result: '',
            actual_result: '',
            external_ticket_url: '',
            external_ticket_key: '',
            external_provider: '',
            external_status: '',
            reopened_count: 0,
            test_run_item_id: null,
            exploratory_session_id: null,
            created_at: BASE_TIMESTAMP,
            updated_at: BASE_TIMESTAMP,
          },
        ],
        attachments: [
          {
            id: 'att-fantasma-999',
            parent_type: 'bug',
            parent_id: 'bug-anexo-fantasma',
            file_name: 'nao_existe.png',
            mime_type: 'image/png',
            relative_path: 'attachments/att-fantasma-999_nao_existe.png',
            size_bytes: 4096,
            created_at: BASE_TIMESTAMP,
          },
        ],
      }),
    },
  ]);

  // 6. Versão de esquema desconhecida (version: 999)
  const unknownVersionZipBuffer = buildZipBuffer([
    {
      name: 'backup.json',
      data: JSON.stringify({
        version: 999,
        exported_at: BASE_TIMESTAMP,
        columns,
        bugs: [],
        attachments: [],
      }),
    },
  ]);

  // Pacote principal `massa-malformada.zip`: contém entrada `../../fora.txt` + `backup.json` sem campos obrigatórios,
  // e também inclui os 6 sub-arquivos .zip para referência.
  const mainMalformedBundle = buildZipBuffer([
    {
      name: 'backup.json',
      data: JSON.stringify({
        version: 999,
        exported_at: BASE_TIMESTAMP,
        columns: [],
      }),
    },
    {
      name: '../../fora.txt',
      data: 'ZIP_SLIP_TEST_PAYLOAD',
    },
    { name: 'casos/01-zip-corrompido.zip', data: corruptedZipBuffer },
    { name: 'casos/02-json-invalido.zip', data: invalidJsonZipBuffer },
    { name: 'casos/03-campo-obrigatorio-faltando.zip', data: missingFieldZipBuffer },
    { name: 'casos/04-zip-slip-path-traversal.zip', data: zipSlipBuffer },
    { name: 'casos/05-anexo-inexistente.zip', data: missingAttachmentZipBuffer },
    { name: 'casos/06-versao-desconhecida.zip', data: unknownVersionZipBuffer },
  ]);

  return {
    mainMalformedBundle,
    cases: {
      '01-zip-corrompido.zip': corruptedZipBuffer,
      '02-json-invalido.zip': invalidJsonZipBuffer,
      '03-campo-obrigatorio-faltando.zip': missingFieldZipBuffer,
      '04-zip-slip-path-traversal.zip': zipSlipBuffer,
      '05-anexo-inexistente.zip': missingAttachmentZipBuffer,
      '06-versao-desconhecida.zip': unknownVersionZipBuffer,
    },
  };
}

// ============================================================================
// Execução via CLI
// ============================================================================
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(MALFORMED_DIR, { recursive: true });

  console.log('Gerando massa-pequena.zip...');
  const small = generateSmallSeedPackage();
  const smallPath = path.join(OUTPUT_DIR, 'massa-pequena.zip');
  fs.writeFileSync(smallPath, small.zipBuffer);
  fs.writeFileSync(path.join(ROOT_DIR, 'massa-pequena.zip'), small.zipBuffer);

  console.log('Gerando massa-grande.zip (1.000 bugs, 500 casos, 30 runs)...');
  const large = generateLargeSeedPackage();
  const largePath = path.join(OUTPUT_DIR, 'massa-grande.zip');
  fs.writeFileSync(largePath, large.zipBuffer);
  fs.writeFileSync(path.join(ROOT_DIR, 'massa-grande.zip'), large.zipBuffer);

  console.log('Gerando massa-malformada.zip e os 6 cenários de falha...');
  const malformed = generateMalformedSeedPackages();
  const malformedPath = path.join(OUTPUT_DIR, 'massa-malformada.zip');
  fs.writeFileSync(malformedPath, malformed.mainMalformedBundle);
  fs.writeFileSync(path.join(ROOT_DIR, 'massa-malformada.zip'), malformed.mainMalformedBundle);

  for (const [fileName, buf] of Object.entries(malformed.cases)) {
    fs.writeFileSync(path.join(MALFORMED_DIR, fileName), buf);
  }

  console.log('\n✅ Pacotes gerados com sucesso:');
  console.log(`  - ${smallPath} (${(small.zipBuffer.length / 1024).toFixed(1)} KB)`);
  console.log(`  - ${largePath} (${(large.zipBuffer.length / 1024).toFixed(1)} KB)`);
  console.log(`  - ${malformedPath} (${(malformed.mainMalformedBundle.length / 1024).toFixed(1)} KB)`);
  console.log(`  - ${MALFORMED_DIR} (6 arquivos .zip individuais para teste negativo)`);
}
