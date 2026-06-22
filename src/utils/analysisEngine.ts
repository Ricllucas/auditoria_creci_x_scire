import {
  AnalysisResult,
  AnalysisRow,
  AnalysisSettings,
  ComparisonStatus,
  ConfidenceLevel,
  ContractInsight,
  ContractualClassification,
  CpfOverrideRule,
  ParsedInputFile,
  ParsedInputRow,
  TicketRecord,
  UploadSectionState,
  UserDirectoryEntry,
} from '../types';
import { GENERIC_TITLE_KEYWORDS, IMPROVEMENT_KEYWORDS, OBLIGATION_KEYWORDS, SECTION_DEFINITIONS } from '../constants';
import { formatCpf, isValidCpf, normalizeCpf } from './cpf';
import { formatCurrency, formatDate, formatNumber, uniqueBy } from './format';

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TEXT_KEY_STOPWORDS = new Set([
  'a',
  'ao',
  'aos',
  'as',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'para',
  'por',
  'sem',
  'um',
  'uma',
]);

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function textToKey(value: string): string {
  return [...new Set(normalizeText(value).split(' ').filter((token) => token.length > 2 && !TEXT_KEY_STOPWORDS.has(token)))]
    .sort()
    .slice(0, 12)
    .join(' ');
}

function normalizeCode(value: string): string {
  return normalizeText(value).replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

function rowToText(row: ParsedInputRow): string {
  return Object.entries(row)
    .filter(([key]) => !key.startsWith('_'))
    .map(([, value]) => String(value ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

function cleanExtractedValue(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[|:;,.–—\-\s]+/, '')
    .replace(/[|:;,.–—\-\s]+$/, '')
    .trim();
}

function extractByPatterns(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ?? match?.[0] ?? '';
    const cleaned = cleanExtractedValue(value);
    if (cleaned) {
      return cleaned;
    }
  }

  return '';
}

function firstFilled(row: ParsedInputRow, aliases: string[]): string {
  const normalizedAliases = aliases.map((alias) => normalizeText(alias));

  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.includes(normalizeText(key))) {
      return String(value ?? '').trim();
    }
  }

  for (const alias of normalizedAliases) {
    const candidate = Object.entries(row).find(([key]) => normalizeText(key).includes(alias));
    if (candidate) {
      return String(candidate[1] ?? '').trim();
    }
  }

  return '';
}

function firstMeaningfulLine(text: string): string {
  const lines = normalizeWhitespace(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.find(
      (line) =>
        !/(cpf|status|situacao|situação|data|hora|valor|departamento|setor|usuario|usuário|solicitante|descricao|descrição|historico|histórico)/i.test(
          line,
        ),
    ) ?? lines[0] ?? ''
  );
}

function splitTextIntoBlocks(text: string, anchorPattern: RegExp): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const blankLineBlocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 12);

  if (blankLineBlocks.length > 1) {
    return blankLineBlocks;
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const blocks: string[] = [];
  let current: string[] = [];
  let currentHasAnchor = false;

  lines.forEach((line) => {
    const isAnchor = anchorPattern.test(line);

    if (isAnchor && current.length >= 3 && currentHasAnchor) {
      blocks.push(current.join('\n'));
      current = [line];
      currentHasAnchor = true;
      return;
    }

    current.push(line);
    currentHasAnchor = currentHasAnchor || isAnchor;
  });

  if (current.length) {
    blocks.push(current.join('\n'));
  }

  return blocks.length ? blocks : [normalized];
}

function looksLikePersonName(value: string): boolean {
  const cleaned = cleanExtractedValue(value);
  const words = normalizeText(cleaned).split(' ').filter(Boolean);

  return (
    words.length >= 2 &&
    words.length <= 7 &&
    /^[A-Za-zÀ-ÿ\s]+$/u.test(cleaned) &&
    !/(departamento|setor|gerencia|gerência|lotacao|lotação|cpf|matricula|matrícula|usuario|usuário)/i.test(cleaned)
  );
}

function extractCpfFromText(text: string): string {
  return extractByPatterns(text, [/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/]);
}

function extractDateFromText(text: string): string {
  return extractByPatterns(text, [
    /(?:data|abertura|criacao|criação|em)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i,
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\b/,
  ]);
}

function extractStatusFromText(text: string): string {
  return extractByPatterns(text, [
    /(?:status|situacao|situação|estado)\s*[:\-]?\s*([^\n]{3,60})/i,
    /\b(aberto|aberta|fechado|fechada|encerrado|encerrada|concluido|concluído|concluida|concluída|pendente|em andamento|em analise|em análise|cancelado|cancelada|suporte)\b/i,
  ]);
}

function extractPersonFromText(text: string): string {
  const labeledValue = extractByPatterns(text, [
    /(?:usuario|usuário|solicitante|nome|colaborador|servidor)\s*[:\-]?\s*([^\n]{4,120})/i,
  ]);

  if (labeledValue && looksLikePersonName(labeledValue)) {
    return labeledValue;
  }

  const lines = normalizeWhitespace(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const cpfLineIndex = lines.findIndex((line) => /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/.test(line));
  const candidates = [
    lines[cpfLineIndex]?.replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, '').trim(),
    lines[cpfLineIndex - 1],
    lines[cpfLineIndex + 1],
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => looksLikePersonName(candidate)) ?? '';
}

function extractDepartmentFromText(text: string): string {
  return extractByPatterns(text, [
    /(?:departamento|depto|gerencia|gerência|lotacao|lotação|area|área)\s*[:\-]?\s*([^\n]{2,80})/i,
  ]);
}

function extractSectorFromText(text: string): string {
  return extractByPatterns(text, [/(?:setor|secao|seção|subsetor)\s*[:\-]?\s*([^\n]{2,80})/i]);
}

function extractCodeFromText(text: string): string {
  return extractByPatterns(text, [
    /(?:codigo|código|chamado|ticket|protocolo|id)\s*(?:n(?:o|º|°|úmero|umero)?)?\s*[:#-]?\s*([A-Z0-9._/-]{3,})/i,
    /\b((?:OS|REQ|INC|CH|TKT)[-_/.]?\d{2,})\b/i,
    /\b([A-Z]{2,10}\s*-\s*\d{2,3})\b/i,
  ]);
}

function extractTitleFromText(text: string): string {
  return (
    extractByPatterns(text, [/(?:titulo|título|assunto|demanda|resumo)\s*[:\-]?\s*([^\n]{4,140})/i]) ||
    cleanExtractedValue(firstMeaningfulLine(text)).slice(0, 140)
  );
}

function extractDescriptionFromText(text: string): string {
  const labeledDescription = extractByPatterns(text, [
    /(?:descricao|descrição|detalhe|historico|histórico|texto|solicitacao|solicitação)\s*[:\-]?\s*([\s\S]{8,500})/i,
  ]);

  return labeledDescription || normalizeWhitespace(text).slice(0, 1200);
}

function extractMinutesText(text: string): string {
  return extractByPatterns(text, [
    /(?:tempo(?:\s+tecnico|\s+técnico)?|duracao|duração|minutos?)\s*[:\-]?\s*([^\n]{1,40})/i,
    /\b(\d{1,2}:\d{2})\b/,
    /\b(\d+(?:[.,]\d+)?\s*h(?:oras?)?(?:\s*\d+(?:[.,]\d+)?\s*m(?:in)?)?)\b/i,
  ]);
}

function extractHoursText(text: string): string {
  return extractByPatterns(text, [/(?:horas?|tempo em horas)\s*[:\-]?\s*([^\n]{1,30})/i]);
}

function extractHourlyRateText(text: string): string {
  return extractByPatterns(text, [
    /(?:valor\/hora|valor hora|vr\.?\s*hora|hora tecnica|hora técnica)\s*[:\-]?\s*(R?\$?\s*[\d.]+,\d{2})/i,
  ]);
}

function extractBilledValueText(text: string): string {
  return extractByPatterns(text, [
    /(?:valor cobrado|total cobrado|cobranca|cobrança|valor total|total)\s*[:\-]?\s*(R?\$?\s*[\d.]+,\d{2})/i,
  ]);
}

function parseExcelDate(value: number): string {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  epoch.setUTCDate(epoch.getUTCDate() + value);
  return epoch.toISOString();
}

function parseDateValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^\d{5}$/.test(trimmed)) {
    return parseExcelDate(Number(trimmed));
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(trimmed)) {
    const [datePart, timePart] = trimmed.split(' ');
    const [day, month, year] = datePart.split('/');
    return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart || '00:00:00'}`).toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

function parseBrazilianNumber(value: string): number {
  const cleaned = value
    .replace(/[R$\s]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .trim();

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMinutes(value: string, hoursValue?: string): number {
  if (hoursValue) {
    const hours = parseBrazilianNumber(hoursValue);
    if (hours > 0) {
      return hours * 60;
    }
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  const hhmm = normalized.match(/^(\d{1,2})[:h](\d{1,2})$/);
  if (hhmm) {
    return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  }

  const hourMinute = normalized.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\s*(\d+(?:[.,]\d+)?)?\s*m?/);
  if (hourMinute) {
    const hours = parseBrazilianNumber(hourMinute[1]);
    const minutes = hourMinute[2] ? parseBrazilianNumber(hourMinute[2]) : 0;
    return hours * 60 + minutes;
  }

  return parseBrazilianNumber(normalized);
}

function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeText(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(' ').filter(Boolean));

  if (!leftTokens.size && !rightTokens.size) {
    return 1;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function compactParts(parts: Array<string | undefined | null>): string {
  return parts
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

function inferDepartmentFromContext(value: string): string {
  const normalized = normalizeText(value);

  if (normalized.includes('procuradoria fiscal')) {
    return 'Procuradoria Fiscal';
  }

  if (normalized.includes('fiscalizacao')) {
    return 'Fiscalização';
  }

  if (normalized.includes('processos disciplinares') || normalized.includes('processos disciplina')) {
    return 'Processos Disciplinares';
  }

  if (normalized.includes('sead')) {
    return 'SEAD';
  }

  if (normalized.includes('ouvidoria')) {
    return 'Ouvidoria';
  }

  if (normalized.includes('juridico')) {
    return 'Jurídico';
  }

  if (normalized.includes('secretaria')) {
    return 'Secretaria';
  }

  return '';
}

function dedupeRows(rows: ParsedInputRow[]): ParsedInputRow[] {
  return uniqueBy(rows, (row) =>
    [
      String(row.codigo ?? '').trim(),
      String(row.cpf ?? '').trim(),
      normalizeText(String(row.titulo ?? '')),
      normalizeText(String(row.descricao ?? '')).slice(0, 120),
      String(row.data ?? '').trim(),
    ].join('|'),
  );
}

function trimTrailingText(text: string, suffix: string): string {
  if (!suffix) {
    return text.trim();
  }

  const normalizedText = normalizeText(text);
  const normalizedSuffix = normalizeText(suffix);
  if (normalizedText.endsWith(normalizedSuffix)) {
    return text.slice(0, Math.max(0, text.length - suffix.length)).trim();
  }

  return text.trim();
}

function extractSequentialCodeTitleDateRows(file: ParsedInputFile): ParsedInputRow[] {
  const normalized = normalizeWhitespace(file.textContent);
  const matches = [...normalized.matchAll(/\b(\d{3,6})\s+([\s\S]+?)\s+(\d{2}\/\d{2}\/\d{4})(?=\s+\d{3,6}\s+|$)/g)];
  if (matches.length < 2) {
    return [];
  }

  const inferredDepartment = inferDepartmentFromContext(`${file.fileName}\n${normalized.slice(0, 400)}`);

  return matches.map((match) => ({
    codigo: cleanExtractedValue(match[1]),
    titulo: cleanExtractedValue(match[2]),
    descricao: cleanExtractedValue(match[2]),
    data: cleanExtractedValue(match[3]),
    departamento: inferredDepartment,
    _rawText: cleanExtractedValue(match[0]),
  }));
}

function extractSequentialCodeTitleDateTimeUserStatusRows(file: ParsedInputFile): ParsedInputRow[] {
  const normalized = normalizeWhitespace(file.textContent);
  const matches = [
    ...normalized.matchAll(
      /\b(\d{3,6})\s+([\s\S]+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+([A-ZÀ-Ý][A-ZÀ-Ý\s]{2,50}?)\s+(SUPORTE|ABERTO|ABERTA|FECHADO|FECHADA|PENDENTE|CONCLUIDO|CONCLUÍDO|EM ANDAMENTO)(?=\s+\d{3,6}\s+|$)/giu,
    ),
  ];

  if (!matches.length) {
    return [];
  }

  const inferredDepartment = inferDepartmentFromContext(`${file.fileName}\n${normalized.slice(0, 400)}`);

  return matches.map((match) => ({
    codigo: cleanExtractedValue(match[1]),
    titulo: cleanExtractedValue(match[2]),
    descricao: cleanExtractedValue(match[2]),
    data: `${cleanExtractedValue(match[3])} ${cleanExtractedValue(match[4])}`,
    usuario: cleanExtractedValue(match[5]),
    status: cleanExtractedValue(match[6]),
    departamento: inferredDepartment,
    _rawText: cleanExtractedValue(match[0]),
  }));
}

function extractDemandReferenceRows(file: ParsedInputFile): ParsedInputRow[] {
  const normalized = normalizeWhitespace(file.textContent);
  const matches = [...normalized.matchAll(/\b([A-Z]{2,10}\s*-\s*\d{2,3})\s+([\s\S]*?)(?=\b[A-Z]{2,10}\s*-\s*\d{2,3}\b|$)/g)];
  if (!matches.length) {
    return [];
  }

  return matches.map((match) => {
    const chunk = cleanExtractedValue(match[2]);
    const status =
      extractByPatterns(chunk, [
        /(Decidiu\s*-\s*se\s+por\s+nao\s+Implementar)$/i,
        /(Decidiu\s*-\s*se\s+por\s+não\s+Implementar)$/i,
        /(Implementada|Implementado|Pendente|Em andamento)$/i,
      ]) || 'Não informado';
    const origin =
      extractByPatterns(chunk, [
        /(Reuniao presencial\/virtual|Reunião presencial\/virtual|Reuniao presencial|Reunião presencial|Homologacao\/Testes|Homologação\/Testes|Homologacao|Homologação|Testes)/i,
      ]) || '';
    const description = trimTrailingText(trimTrailingText(chunk, status), origin);
    const title = description.split(/\s+/).slice(0, 8).join(' ');

    return {
      codigo: cleanExtractedValue(match[1]),
      titulo: cleanExtractedValue(title),
      descricao: cleanExtractedValue(description),
      status: cleanExtractedValue(status),
      departamento: inferDepartmentFromContext(`${file.fileName}\n${chunk}`),
      _origemSolicitacao: cleanExtractedValue(origin),
      _rawText: cleanExtractedValue(match[0]),
    };
  });
}

function extractCompactUserDirectoryRows(file: ParsedInputFile): ParsedInputRow[] {
  const normalized = normalizeWhitespace(file.textContent);
  const matches = [
    ...normalized.matchAll(
      /(\d{3}[.\s]?\d{3}[.\s]?\d{3}\s*-\s*\d{2}|\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})\s+([\s\S]*?)(?=(?:\d{3}[.\s]?\d{3}[.\s]?\d{3}\s*-\s*\d{2}|\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})|$)/g,
    ),
  ];

  if (!matches.length) {
    return [];
  }

  const knownDepartments = [
    'Processos Disciplinares',
    'Procuradoria Fiscal',
    'Fiscalização',
    'Ouvidoria',
    'Secretaria',
    'Jurídico',
    'SEAD',
  ];

  return matches.map((match) => {
    const remainder = cleanExtractedValue(match[2]);
    const department =
      knownDepartments.find((item) => normalizeText(remainder).endsWith(normalizeText(item))) ||
      inferDepartmentFromContext(remainder);
    const userName = department ? remainder.slice(0, Math.max(0, remainder.length - department.length)).trim() : remainder;

    return {
      cpf: cleanExtractedValue(match[1]),
      usuario: cleanExtractedValue(userName),
      departamento: cleanExtractedValue(department),
      _rawText: cleanExtractedValue(match[0]),
    };
  });
}

function extractDirectoryRowsFromText(file: ParsedInputFile): ParsedInputRow[] {
  const compactRows = extractCompactUserDirectoryRows(file);
  if (compactRows.length > 1) {
    return dedupeRows(compactRows);
  }

  const rows: ParsedInputRow[] = [];

  splitTextIntoBlocks(file.textContent, /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/).forEach((block) => {
    const cpf = extractCpfFromText(block);
    if (!cpf) {
      return;
    }

    const department = extractDepartmentFromText(block) || inferDepartmentFromContext(`${file.fileName}\n${block}`);
    const sector = extractSectorFromText(block);
    const userName = extractPersonFromText(block) || extractTitleFromText(block);

    rows.push({
      cpf,
      usuario: userName,
      departamento: department,
      setor: sector,
      _rawText: block,
    });
  });

  return dedupeRows(rows);
}

function extractTicketRowsFromText(file: ParsedInputFile): ParsedInputRow[] {
  const structuredRows = dedupeRows([
    ...extractSequentialCodeTitleDateTimeUserStatusRows(file),
    ...extractSequentialCodeTitleDateRows(file),
    ...extractDemandReferenceRows(file),
  ]);

  if (structuredRows.length > 1) {
    return structuredRows;
  }

  return dedupeRows(
    splitTextIntoBlocks(
      file.textContent,
      /(?:codigo|código|chamado|ticket|protocolo|cpf|solicitante|usuario|usuário|titulo|título|assunto|demanda|descricao|descrição|status)/i,
    )
      .map((block) => {
        const normalizedBlock = normalizeWhitespace(block);
        if (!normalizedBlock) {
          return null;
        }

        const row: ParsedInputRow = {
          codigo: extractCodeFromText(normalizedBlock),
          titulo: extractTitleFromText(normalizedBlock),
          descricao: extractDescriptionFromText(normalizedBlock),
          data: extractDateFromText(normalizedBlock),
          status: extractStatusFromText(normalizedBlock),
          cpf: extractCpfFromText(normalizedBlock),
          usuario: extractPersonFromText(normalizedBlock),
          departamento: extractDepartmentFromText(normalizedBlock) || inferDepartmentFromContext(`${file.fileName}\n${normalizedBlock}`),
          setor: extractSectorFromText(normalizedBlock),
          minutos: extractMinutesText(normalizedBlock),
          horas: extractHoursText(normalizedBlock),
          'valor hora': extractHourlyRateText(normalizedBlock),
          'valor cobrado': extractBilledValueText(normalizedBlock),
          _rawText: normalizedBlock,
        };

        const evidenceCount = [
          row.codigo,
          row.cpf,
          row.usuario,
          row.departamento,
          row.data,
          row.status,
          row.minutos,
          row['valor cobrado'],
        ].filter(Boolean).length;

        const title = String(row.titulo ?? '');
        const description = String(row.descricao ?? '');

        if (evidenceCount === 0 && title.length < 12 && description.length < 30) {
          return null;
        }

        return row;
      })
      .filter((row): row is ParsedInputRow => Boolean(row)),
  );
}

function extractUserDirectory(files: ParsedInputFile[]): UserDirectoryEntry[] {
  const rows = files.flatMap((file) => [
    ...file.rows.map((row) => ({ row, fileName: file.fileName })),
    ...extractDirectoryRowsFromText(file).map((row) => ({ row, fileName: file.fileName })),
  ]);

  return rows
    .map(({ row, fileName }) => {
      const cpfRaw = firstFilled(row, ['cpf', 'documento', 'doc']);
      const userName = firstFilled(row, ['usuario', 'usuário', 'nome', 'solicitante', 'colaborador']);
      const department = firstFilled(row, ['departamento', 'depto', 'gerencia', 'gerência', 'lotacao', 'lotação', 'area']);
      const sector = firstFilled(row, ['setor', 'secao', 'seção', 'subsetor']);
      const cpf = normalizeCpf(cpfRaw);

      if (!cpf && !userName && !department) {
        return null;
      }

      return {
        cpf,
        cpfRaw,
        userName,
        department,
        sector,
        sourceFile: fileName,
      };
    })
    .filter((entry): entry is UserDirectoryEntry => Boolean(entry));
}

function extractTickets(files: ParsedInputFile[], origin: TicketRecord['origin']): TicketRecord[] {
  const textRows = files.flatMap((file) =>
    extractTicketRowsFromText(file).map((row) => ({
      sourceFile: file.fileName,
      row,
    })),
  );

  const tabularRows = files.flatMap((file) => file.rows.map((row) => ({ sourceFile: file.fileName, row })));

  return [...tabularRows, ...textRows]
    .map(({ row, sourceFile }) => {
      const rawText = rowToText(row);
      const code = firstFilled(row, ['codigo', 'código', 'chamado', 'ticket', 'protocolo', 'id']) || extractCodeFromText(rawText);
      const title = firstFilled(row, ['titulo', 'título', 'assunto', 'demanda', 'resumo']) || extractTitleFromText(rawText);
      const description =
        firstFilled(row, ['descricao', 'descrição', 'detalhe', 'historico', 'histórico', 'texto']) ||
        extractDescriptionFromText(rawText);
      const openedAt = parseDateValue(
        firstFilled(row, ['data', 'abertura', 'criacao', 'criação', 'data abertura']) || extractDateFromText(rawText),
      );
      const status = firstFilled(row, ['status', 'situação', 'situacao', 'estado']) || extractStatusFromText(rawText);
      const cpfRaw = firstFilled(row, ['cpf', 'documento', 'doc']) || extractCpfFromText(rawText);
      const userName = firstFilled(row, ['usuario', 'usuário', 'solicitante', 'nome']) || extractPersonFromText(rawText);
      const department =
        firstFilled(row, ['departamento', 'depto', 'area', 'área', 'gerencia']) ||
        extractDepartmentFromText(rawText) ||
        inferDepartmentFromContext(`${sourceFile}\n${rawText}`);
      const sector = firstFilled(row, ['setor', 'secao', 'seção']) || extractSectorFromText(rawText);
      const minutes = parseMinutes(
        firstFilled(row, ['minutos', 'tempo', 'tempo tecnico', 'tempo técnico', 'duracao', 'duração']) ||
          extractMinutesText(rawText),
        firstFilled(row, ['horas', 'tempo horas', 'tempo em horas']) || extractHoursText(rawText),
      );
      const hourlyRate = parseBrazilianNumber(
        firstFilled(row, ['valor hora', 'valor/hora', 'vr hora', 'hora tecnica', 'hora técnica']) ||
          extractHourlyRateText(rawText),
      );
      const billedValue = parseBrazilianNumber(
        firstFilled(row, ['valor cobrado', 'valor', 'cobranca', 'cobrança', 'total cobrado', 'total']) ||
          extractBilledValueText(rawText),
      );
      const cpf = normalizeCpf(cpfRaw);

      if (!code && !title && !description && !cpf && !userName) {
        return null;
      }

      return {
        origin,
        sourceFile,
        code,
        title,
        description,
        openedAt,
        status,
        cpf,
        cpfRaw,
        userName,
        department,
        sector,
        minutes,
        hours: minutes / 60,
        billedValue,
        hourlyRate,
        rawValues: row,
      };
    })
    .filter((ticket): ticket is TicketRecord => Boolean(ticket));
}

function extractContractInsights(files: ParsedInputFile[]): ContractInsight[] {
  const insights: ContractInsight[] = [];

  files.forEach((file) => {
    const content = normalizeWhitespace([file.textContent, ...file.rows.map((row) => Object.values(row).join(' '))].join('\n'));

    if (!content) {
      insights.push({
        sourceFile: file.fileName,
        kind: 'document_limit',
        label: 'Documento sem conteúdo textual extraível',
        excerpt: 'O arquivo foi anexado, mas o navegador não conseguiu extrair conteúdo suficiente.',
      });
      return;
    }

    const rateMatches = [...content.matchAll(/R\$\s*([\d.]+,\d{2})/g)];
    rateMatches.forEach((match) => {
      const index = match.index ?? 0;
      const excerpt = content.slice(Math.max(0, index - 90), index + 140);
      if (/hora|tecnic|suporte|servico|serviço/i.test(excerpt)) {
        insights.push({
          sourceFile: file.fileName,
          kind: 'hourly_rate',
          label: 'Valor/hora identificado em documento contratual',
          excerpt,
          value: parseBrazilianNumber(match[0]),
        });
      }
    });

    const keywordRules: Array<{ kind: ContractInsight['kind']; label: string; keywords: string[] }> = [
      {
        kind: 'continuous_obligation',
        label: 'Trecho associado a suporte, manutenção ou obrigação contínua',
        keywords: ['suporte', 'manutenção', 'corretiva', 'assistência técnica', 'sustentação'],
      },
      {
        kind: 'on_demand_service',
        label: 'Trecho associado a serviço sob demanda ou evolução',
        keywords: ['sob demanda', 'melhoria', 'evolutiva', 'customização', 'desenvolvimento'],
      },
      {
        kind: 'payment_rule',
        label: 'Trecho associado a regra de pagamento, aceite ou medição',
        keywords: ['pagamento', 'aceite', 'medição', 'faturamento', 'glosa'],
      },
      {
        kind: 'franchise_hours',
        label: 'Trecho associado a franquia ou banco de horas',
        keywords: ['franquia', 'banco de horas', 'horas mensais'],
      },
      {
        kind: 'module',
        label: 'Trecho associado a módulo, integração ou funcionalidade contratada',
        keywords: ['módulo', 'integração', 'webservice', 'funcionalidade'],
      },
    ];

    keywordRules.forEach((rule) => {
      rule.keywords.forEach((keyword) => {
        const index = normalizeText(content).indexOf(normalizeText(keyword));
        if (index >= 0) {
          insights.push({
            sourceFile: file.fileName,
            kind: rule.kind,
            label: rule.label,
            excerpt: content.slice(Math.max(0, index - 90), index + 160),
          });
        }
      });
    });
  });

  return uniqueBy(insights, (item) => `${item.sourceFile}-${item.kind}-${normalizeText(item.excerpt).slice(0, 80)}`);
}

function chooseApplicableHourlyRate(settings: AnalysisSettings, contractInsights: ContractInsight[]): number {
  if (!settings.useContractHourlyRate) {
    return settings.hourlyRate;
  }

  const contractRate = [...contractInsights]
    .reverse()
    .find((insight) => insight.kind === 'hourly_rate' && insight.value && insight.value > 0);

  return contractRate?.value ?? settings.hourlyRate;
}

function resolveOfficialDepartment(
  cpf: string,
  userDirectory: UserDirectoryEntry[],
  overrides: CpfOverrideRule[],
): {
  userName: string;
  department: string;
  sector: string;
  criterion: string;
  probableDepartment: string;
  hasMultipleLinks: boolean;
} {
  if (!cpf) {
    return {
      userName: '',
      department: '',
      sector: '',
      criterion: 'CPF ausente ou ilegível',
      probableDepartment: '',
      hasMultipleLinks: false,
    };
  }

  const normalized = normalizeCpf(cpf);
  const override = overrides.find((item) => normalizeCpf(item.cpf) === normalized);
  if (override) {
    return {
      userName: override.userName,
      department: override.officialDepartment,
      sector: '',
      criterion: 'Redefinição administrativa de CPF',
      probableDepartment: override.officialDepartment,
      hasMultipleLinks: false,
    };
  }

  const matches = userDirectory.filter((entry) => entry.cpf === normalized);
  if (!matches.length) {
    return {
      userName: '',
      department: '',
      sector: '',
      criterion: 'CPF não localizado na base oficial do CRECI/PR',
      probableDepartment: '',
      hasMultipleLinks: false,
    };
  }

  const departments = uniqueBy(
    matches.filter((entry) => entry.department),
    (entry) => normalizeText(entry.department),
  );

  if (departments.length > 1) {
    return {
      userName: matches[0].userName,
      department: '',
      sector: '',
      criterion: 'CPF com múltiplo vínculo não resolvido',
      probableDepartment: departments[0].department,
      hasMultipleLinks: true,
    };
  }

  return {
    userName: matches[0].userName,
    department: matches[0].department,
    sector: matches[0].sector,
    criterion: 'Base oficial do CRECI/PR por CPF',
    probableDepartment: matches[0].department,
    hasMultipleLinks: false,
  };
}

function signature(ticket: TicketRecord): string {
  const dateKey = ticket.openedAt ? ticket.openedAt.slice(0, 10) : '';
  return [normalizeCode(ticket.code), textToKey(ticket.title), textToKey(ticket.description), normalizeText(ticket.cpf), normalizeText(dateKey)]
    .filter(Boolean)
    .join('|');
}

function ticketsMatch(left: TicketRecord, right: TicketRecord, threshold: number): boolean {
  const sameCode = Boolean(left.code && right.code && normalizeCode(left.code) === normalizeCode(right.code));
  if (sameCode) {
    return true;
  }

  const sameCpf = Boolean(left.cpf && right.cpf && left.cpf === right.cpf);
  const sameUser =
    Boolean(left.userName && right.userName) && normalizeText(left.userName) === normalizeText(right.userName);
  const sameDepartment =
    Boolean(left.department && right.department) && normalizeText(left.department) === normalizeText(right.department);
  const sameDate =
    Boolean(left.openedAt && right.openedAt) && left.openedAt.slice(0, 10) === right.openedAt.slice(0, 10);
  const similarity = jaccardSimilarity(compactParts([left.title, left.description]), compactParts([right.title, right.description]));

  let score = 0;
  if (sameCpf) {
    score += 3;
  }
  if (sameUser) {
    score += 2;
  }
  if (sameDepartment) {
    score += 1;
  }
  if (sameDate) {
    score += 1;
  }
  if (similarity >= threshold) {
    score += 3;
  } else if (similarity >= threshold / 1.6) {
    score += 2;
  } else if (similarity >= threshold / 2) {
    score += 1;
  }

  return score >= 4 || (sameCpf && similarity >= threshold / 2) || (sameDate && similarity >= threshold);
}

function buildTicketGroups(
  creciTickets: TicketRecord[],
  scireTickets: TicketRecord[],
  threshold: number,
): Array<{ key: string; creci: TicketRecord[]; scire: TicketRecord[] }> {
  const groups: Array<{ key: string; creci: TicketRecord[]; scire: TicketRecord[] }> = [];

  scireTickets.forEach((ticket) => {
    groups.push({
      key: normalizeCode(ticket.code) || signature(ticket) || `scire-${groups.length + 1}`,
      creci: [],
      scire: [ticket],
    });
  });

  creciTickets.forEach((ticket) => {
    const match = groups.find((group) => group.scire.some((candidate) => ticketsMatch(ticket, candidate, threshold)));

    if (match) {
      match.creci.push(ticket);
      if (!match.key) {
        match.key = normalizeCode(ticket.code) || signature(ticket);
      }
      return;
    }

    const sameOriginMatch = groups.find((group) => group.creci.some((candidate) => ticketsMatch(ticket, candidate, threshold)));
    if (sameOriginMatch) {
      sameOriginMatch.creci.push(ticket);
      return;
    }

    groups.push({
      key: normalizeCode(ticket.code) || signature(ticket) || `creci-${groups.length + 1}`,
      creci: [ticket],
      scire: [],
    });
  });

  return groups.map((group, index) => ({
    ...group,
    key: group.key || `grupo-${index + 1}`,
  }));
}

function detectClassification(
  text: string,
  hasContracts: boolean,
  duplicate: boolean,
  hasMissingEvidence: boolean,
): ContractualClassification {
  if (duplicate) {
    return 'Duplicidade';
  }

  const normalized = normalizeText(text);
  const obligationScore = OBLIGATION_KEYWORDS.filter((keyword) => normalized.includes(normalizeText(keyword))).length;
  const improvementScore = IMPROVEMENT_KEYWORDS.filter((keyword) => normalized.includes(normalizeText(keyword))).length;

  if (obligationScore > 0 && improvementScore > 0) {
    return 'Misto / Revisão Necessária';
  }

  if (improvementScore > 0) {
    return 'Melhoria Evolutiva';
  }

  if (obligationScore > 0) {
    return 'Obrigação Contratual';
  }

  if (hasMissingEvidence) {
    return 'Pendente de Validação';
  }

  if (!hasContracts) {
    return 'Fora do Escopo Documental Disponível';
  }

  return 'Pendente de Validação';
}

function detectConfidence(
  comparison: ComparisonStatus,
  classification: ContractualClassification,
  validCpf: boolean,
  officialDepartment: string,
  hasContracts: boolean,
  title: string,
  description: string,
): ConfidenceLevel {
  const genericTitle = GENERIC_TITLE_KEYWORDS.some((keyword) => normalizeText(title).includes(normalizeText(keyword)));

  if (
    !validCpf ||
    !officialDepartment ||
    !description ||
    genericTitle ||
    comparison === 'Duplicado' ||
    comparison === 'Pendente de validação' ||
    classification === 'Pendente de Validação'
  ) {
    return 'Baixa confiança';
  }

  if (hasContracts && comparison === 'Convergente' && classification !== 'Misto / Revisão Necessária') {
    return 'Alta confiança';
  }

  return 'Média confiança';
}

function detectComparison(
  creciTickets: TicketRecord[],
  scireTickets: TicketRecord[],
  threshold: number,
): ComparisonStatus {
  if (creciTickets.length > 1 || scireTickets.length > 1) {
    return 'Duplicado';
  }

  if (!creciTickets.length && scireTickets.length) {
    return 'Ausente no CRECI/PR';
  }

  if (creciTickets.length && !scireTickets.length) {
    return 'Ausente na SCIRE';
  }

  const creci = creciTickets[0];
  const scire = scireTickets[0];

  if (!creci || !scire) {
    return 'Pendente de validação';
  }

  const cpfMatch = creci.cpf && scire.cpf ? creci.cpf === scire.cpf : false;
  const userMatch =
    creci.userName && scire.userName ? normalizeText(creci.userName) === normalizeText(scire.userName) : false;
  const departmentMatch =
    creci.department && scire.department ? normalizeText(creci.department) === normalizeText(scire.department) : false;
  const descriptionSimilarity = jaccardSimilarity(compactParts([creci.title, creci.description]), compactParts([scire.title, scire.description]));

  const matches = [cpfMatch, userMatch, departmentMatch, descriptionSimilarity >= threshold].filter(Boolean).length;

  if (matches === 4) {
    return 'Convergente';
  }

  if (creci.cpf && scire.cpf && !cpfMatch) {
    return 'Divergente por CPF';
  }

  if (creci.userName && scire.userName && !userMatch) {
    return 'Divergente por usuário';
  }

  if (creci.department && scire.department && !departmentMatch) {
    return 'Divergente por departamento';
  }

  if (descriptionSimilarity < threshold / 1.5) {
    return 'Divergente por descrição';
  }

  return 'Parcialmente convergente';
}

function recommendationFor(
  classification: ContractualClassification,
  confidence: ConfidenceLevel,
  comparison: ComparisonStatus,
  billedValue: number,
): string {
  if (classification === 'Obrigação Contratual') {
    return 'Glosar integralmente';
  }

  if (classification === 'Duplicidade') {
    return 'Glosar por duplicidade';
  }

  if (classification === 'Misto / Revisão Necessária') {
    return 'Glosar parcialmente';
  }

  if (
    classification === 'Pendente de Validação' ||
    classification === 'Fora do Escopo Documental Disponível' ||
    confidence === 'Baixa confiança' ||
    comparison === 'Pendente de validação'
  ) {
    return 'Validar administrativamente';
  }

  if (classification === 'Melhoria Evolutiva' && billedValue > 0) {
    return 'Pagar';
  }

  if (classification === 'Melhoria Evolutiva' && billedValue <= 0) {
    return 'Revisar contrato';
  }

  return 'Validar administrativamente';
}

function sum(items: number[]): number {
  return items.reduce((total, item) => total + item, 0);
}

function groupCount<T>(items: T[], getName: (item: T) => string): Array<{ name: string; total: number }> {
  const map = new Map<string, number>();

  items.forEach((item) => {
    const name = getName(item) || 'Não informado';
    map.set(name, (map.get(name) ?? 0) + 1);
  });

  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 12);
}

export function runAuditAnalysis(params: {
  sections: UploadSectionState[];
  parsedFiles: ParsedInputFile[];
  settings: AnalysisSettings;
  overrides: CpfOverrideRule[];
}): AnalysisResult {
  const { sections, parsedFiles, settings, overrides } = params;

  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const fileGroups = {
    userBase: parsedFiles.filter((file) => file.sectionId === 'userBase' && file.status === 'parsed'),
    creciCalls: parsedFiles.filter((file) => file.sectionId === 'creciCalls' && file.status === 'parsed'),
    scireCalls: parsedFiles.filter((file) => file.sectionId === 'scireCalls' && file.status === 'parsed'),
    contracts: parsedFiles.filter((file) => file.sectionId === 'contracts' && file.status === 'parsed'),
  };

  const alerts = SECTION_DEFINITIONS.flatMap((definition) => {
    const section = sectionMap.get(definition.id);
    if (!section || !section.files.length) {
      return [definition.riskMessage];
    }
    if (!section.confirmed) {
      return [`A seção "${definition.title}" possui arquivos não confirmados pelo usuário.`];
    }
    return [];
  });

  const invalidFileWarnings = parsedFiles
    .filter((file) => file.status === 'invalid')
    .flatMap((file) => file.warnings.map((warning) => `${file.fileName}: ${warning}`));

  const textlessPdfWarnings = parsedFiles
    .filter((file) => file.documentType === 'pdf' && file.status === 'parsed' && !normalizeWhitespace(file.textContent))
    .map((file) => `${file.fileName}: PDF sem texto extraível. Se o arquivo for imagem/escaneado, a análise ficará limitada sem OCR.`);

  const limitations = [
    ...alerts,
    ...invalidFileWarnings,
    ...textlessPdfWarnings,
    ...(!fileGroups.contracts.length
      ? ['Sem documentos contratuais legíveis, a classificação poderá ficar limitada a critérios técnicos e conservadores.']
      : []),
  ];

  const userDirectory = extractUserDirectory(fileGroups.userBase);
  const creciTickets = extractTickets(fileGroups.creciCalls, 'CRECI/PR');
  const scireTickets = extractTickets(fileGroups.scireCalls, 'SCIRE');
  const contractInsights = extractContractInsights(fileGroups.contracts);
  const appliedRate = chooseApplicableHourlyRate(settings, contractInsights);
  const groups = buildTicketGroups(creciTickets, scireTickets, settings.similarityThreshold);

  const rows: AnalysisRow[] = groups.map((group, index) => {
    const representative = group.scire[0] ?? group.creci[0];
    const comparison = detectComparison(group.creci, group.scire, settings.similarityThreshold);
    const mergedText = compactParts([
      representative?.title,
      representative?.description,
      group.creci[0]?.title,
      group.creci[0]?.description,
      group.scire[0]?.title,
      group.scire[0]?.description,
    ]);
    const cpf = representative?.cpf ?? '';
    const validCpf = isValidCpf(cpf);
    const resolution = resolveOfficialDepartment(cpf, userDirectory, overrides);
    const hasMissingEvidence =
      !representative?.description ||
      !representative?.title ||
      (!representative?.minutes && group.scire.length > 0) ||
      !validCpf ||
      comparison === 'Ausente no CRECI/PR' ||
      comparison === 'Pendente de validação' ||
      resolution.hasMultipleLinks;

    const classification = detectClassification(
      mergedText,
      fileGroups.contracts.length > 0,
      comparison === 'Duplicado',
      hasMissingEvidence,
    );

    const confidence = detectConfidence(
      comparison,
      classification,
      validCpf,
      resolution.department,
      fileGroups.contracts.length > 0,
      representative?.title ?? '',
      representative?.description ?? '',
    );

    const scireMinutes = sum(group.scire.map((ticket) => ticket.minutes));
    const creciMinutes = sum(group.creci.map((ticket) => ticket.minutes));
    const timeMinutes = scireMinutes || creciMinutes || representative?.minutes || 0;
    const timeHours = timeMinutes / 60;
    const sourceHourlyRate = group.scire.find((ticket) => ticket.hourlyRate > 0)?.hourlyRate ?? appliedRate;
    const billedValueFromScire = sum(group.scire.map((ticket) => ticket.billedValue));
    const billedValue = billedValueFromScire > 0 ? billedValueFromScire : group.scire.length ? timeHours * sourceHourlyRate : 0;

    let technicalDueValue = 0;
    let simulatedValue = 0;

    if (classification === 'Melhoria Evolutiva' && confidence !== 'Baixa confiança') {
      if (group.scire.length) {
        technicalDueValue = timeHours * appliedRate;
      } else {
        simulatedValue = timeHours * appliedRate;
      }
    }

    const glosableValue = Math.max(0, billedValue - technicalDueValue);
    const callDate = representative?.openedAt ? formatDate(representative.openedAt) : 'Não informado';
    const demandOrigin = group.creci.length && group.scire.length ? 'Ambas' : group.scire.length ? 'SCIRE' : 'CRECI/PR';

    const probableDepartment = resolution.probableDepartment || representative?.department || '';
    const inconsistencies = [
      !validCpf ? 'CPF ausente, inválido ou não verificável' : '',
      comparison === 'Divergente por departamento' ? 'Divergência entre departamento CRECI x SCIRE' : '',
      comparison === 'Divergente por CPF' ? 'Divergência de CPF entre as bases' : '',
      comparison === 'Divergente por usuário' ? 'Divergência de usuário entre as bases' : '',
      comparison === 'Divergente por descrição' ? 'Divergência descritiva relevante' : '',
      comparison === 'Ausente no CRECI/PR' ? 'Cobrança apresentada sem registro interno equivalente' : '',
      comparison === 'Ausente na SCIRE' ? 'Registro interno sem apresentação correspondente na SCIRE' : '',
      comparison === 'Duplicado' ? 'Possível duplicidade ou fragmentação artificial' : '',
      resolution.hasMultipleLinks ? 'CPF com múltiplo vínculo não resolvido' : '',
      !resolution.department && probableDepartment ? `Departamento provável identificado: ${probableDepartment}` : '',
      classification === 'Fora do Escopo Documental Disponível' ? 'Escopo contratual insuficiente para conclusão' : '',
    ]
      .filter(Boolean)
      .join('; ');

    const technicalBasis = compactParts([
      classification === 'Obrigação Contratual'
        ? 'Indícios de manutenção corretiva, suporte ou recomposição de funcionalidade'
        : '',
      classification === 'Melhoria Evolutiva'
        ? 'Indícios de criação, ampliação ou customização funcional além do suporte ordinário'
        : '',
      classification === 'Misto / Revisão Necessária'
        ? 'Há elementos corretivos e evolutivos no mesmo chamado, exigindo segregação de horas'
        : '',
      comparison === 'Ausente no CRECI/PR' ? 'Cobrança sem espelho completo na base interna do CRECI/PR' : '',
      confidence === 'Baixa confiança' ? 'Elementos insuficientes para reconhecimento automático do valor devido' : '',
    ]);

    const contractualBasis = compactParts([
      contractInsights.some((item) => item.kind === 'hourly_rate')
        ? `Valor/hora contratual aplicável considerado em ${formatCurrency(appliedRate)}`
        : `Valor/hora de referência manual considerado em ${formatCurrency(appliedRate)}`,
      contractInsights.some((item) => item.kind === 'continuous_obligation')
        ? 'Documentos contratuais indicam obrigações contínuas de suporte e manutenção'
        : '',
      contractInsights.some((item) => item.kind === 'on_demand_service')
        ? 'Documentos contratuais registram prestação evolutiva ou sob demanda'
        : '',
      !fileGroups.contracts.length ? 'Sem documento contratual legível para vinculação integral do escopo' : '',
    ]);

    const recommendation = recommendationFor(classification, confidence, comparison, billedValue);

    return {
      id: group.key || String(index + 1),
      period:
        settings.periodStart && settings.periodEnd
          ? `${formatDate(settings.periodStart)} a ${formatDate(settings.periodEnd)}`
          : 'Período não informado',
      sourceFileOrigin: uniqueBy(
        [...group.creci, ...group.scire].map((ticket) => ticket.sourceFile),
        (item) => item,
      ).join(', '),
      callCode: representative?.code || 'Sem código',
      title: representative?.title || 'Sem título',
      summaryDescription: representative?.description || 'Sem descrição',
      demandOrigin,
      callDate,
      status: representative?.status || 'Não informado',
      cpf: validCpf ? formatCpf(cpf) : representative?.cpfRaw || 'Não informado',
      identifiedUser: resolution.userName || representative?.userName || 'Não identificado',
      officialDepartment: resolution.department || 'Pendente de validação de vínculo funcional',
      officialSector: resolution.sector || 'Não informado',
      scireDepartment: group.scire[0]?.department || 'Não informado',
      comparison,
      departmentCriterion: resolution.criterion,
      contractualClassification: classification,
      classificationType:
        classification === 'Melhoria Evolutiva'
          ? 'Evolutiva'
          : classification === 'Obrigação Contratual'
            ? 'Corretiva/contínua'
            : classification === 'Misto / Revisão Necessária'
              ? 'Misto'
              : classification === 'Duplicidade'
                ? 'Duplicidade'
                : 'Pendente',
      timeMinutes,
      timeHours,
      appliedHourlyRate: appliedRate,
      billedValue,
      technicalDueValue,
      glosableValue,
      simulatedValue,
      confidenceLevel: confidence,
      technicalBasis: technicalBasis || 'Sem base técnica suficiente',
      contractualBasis: contractualBasis || 'Sem base contratual suficiente',
      inconsistencies: inconsistencies || 'Nenhuma inconsistência relevante identificada',
      recommendation,
      observations: compactParts([
        group.creci.length > 1 || group.scire.length > 1 ? 'Há múltiplos registros associados ao mesmo agrupamento.' : '',
        representative?.rawValues._planilha ? `Planilha de origem: ${String(representative.rawValues._planilha)}` : '',
        representative?.rawValues._origemSolicitacao ? `Origem informada: ${String(representative.rawValues._origemSolicitacao)}` : '',
      ]),
      probableDepartment,
    };
  });

  const billedValue = sum(rows.map((row) => row.billedValue));
  const technicalDueValue = sum(rows.map((row) => row.technicalDueValue));
  const glosableValue = sum(rows.map((row) => row.glosableValue));
  const simulatedValue = sum(rows.map((row) => row.simulatedValue));
  const totalHoursScire = sum(scireTickets.map((ticket) => ticket.hours));
  const recognizedHours = sum(
    rows
      .filter((row) => row.contractualClassification === 'Melhoria Evolutiva' && row.confidenceLevel !== 'Baixa confiança')
      .map((row) => row.timeHours),
  );
  const glosableHours = sum(
    rows
      .filter((row) => row.contractualClassification !== 'Melhoria Evolutiva' || row.confidenceLevel === 'Baixa confiança')
      .map((row) => row.timeHours),
  );

  const payableItems = rows.filter((row) => row.recommendation === 'Pagar');
  const glosableItems = rows.filter((row) => row.recommendation.includes('Glosar'));
  const pendingItems = rows.filter((row) => row.recommendation === 'Validar administrativamente');
  const divergenceItems = rows.filter(
    (row) => row.comparison !== 'Convergente' && row.comparison !== 'Ausente na SCIRE' && row.comparison !== 'Ausente no CRECI/PR',
  );
  const duplicateItems = rows.filter((row) => row.comparison === 'Duplicado' || row.contractualClassification === 'Duplicidade');

  const dashboard = {
    totalDemands: rows.length,
    scireDemands: rows.filter((row) => row.demandOrigin === 'SCIRE').length,
    creciDemands: rows.filter((row) => row.demandOrigin === 'CRECI/PR').length,
    bothBases: rows.filter((row) => row.demandOrigin === 'Ambas').length,
    onlyScire: rows.filter((row) => row.comparison === 'Ausente no CRECI/PR').length,
    onlyCreci: rows.filter((row) => row.comparison === 'Ausente na SCIRE').length,
    contractualObligations: rows.filter((row) => row.contractualClassification === 'Obrigação Contratual').length,
    evolutionaryImprovements: rows.filter((row) => row.contractualClassification === 'Melhoria Evolutiva').length,
    mixedCases: rows.filter((row) => row.contractualClassification === 'Misto / Revisão Necessária').length,
    pendingValidation: rows.filter((row) => row.contractualClassification === 'Pendente de Validação').length,
    duplicates: rows.filter((row) => row.contractualClassification === 'Duplicidade').length,
    billedValue,
    technicalDueValue,
    glosableValue,
    estimatedSavings: glosableValue,
    glosaPercentage: billedValue > 0 ? (glosableValue / billedValue) * 100 : 0,
    totalHoursScire,
    recognizedHours,
    glosableHours,
    simulatedValue,
    byDepartment: groupCount(rows, (row) => row.officialDepartment),
    byUser: groupCount(rows, (row) => row.identifiedUser),
    byStatus: groupCount(rows, (row) => row.status),
    byConfidence: groupCount(rows, (row) => row.confidenceLevel),
    byClassification: groupCount(rows, (row) => row.contractualClassification),
  };

  const reportSections = [
    {
      title: 'Metodologia aplicada',
      items: [
        'Leitura dos arquivos anexados por seção, com extração de texto livre, OCR para PDFs escaneados e heurísticas específicas para listas tabulares em PDF.',
        'Cruzamento entre base oficial de usuários, chamados CRECI/PR, chamados SCIRE e documentos contratuais.',
        'Agrupamento por código quando disponível e, na ausência dele, por similaridade entre CPF, data, usuário e conteúdo textual.',
        'Classificação conservadora das demandas entre obrigação contratual, melhoria evolutiva, caso misto, pendência e duplicidade.',
        'Cálculo de valor cobrado, valor tecnicamente devido, valor glosável e valor simulado para itens não faturados.',
      ],
    },
    {
      title: 'Resumo quantitativo',
      items: [
        `Total de demandas analisadas: ${rows.length}.`,
        `Demandas em ambas as bases: ${dashboard.bothBases}; apenas na SCIRE: ${dashboard.onlyScire}; apenas no CRECI/PR: ${dashboard.onlyCreci}.`,
        `Obrigações contratuais: ${dashboard.contractualObligations}; melhorias evolutivas: ${dashboard.evolutionaryImprovements}; casos mistos: ${dashboard.mixedCases}.`,
        `Pendentes de validação: ${dashboard.pendingValidation}; duplicidades: ${dashboard.duplicates}.`,
        `Horas apresentadas pela SCIRE: ${formatNumber(dashboard.totalHoursScire)}; horas reconhecidas como melhoria: ${formatNumber(dashboard.recognizedHours)}; horas glosáveis: ${formatNumber(dashboard.glosableHours)}.`,
      ],
    },
    {
      title: 'Resumo financeiro',
      items: [
        `Valor total cobrado pela SCIRE: ${formatCurrency(billedValue)}.`,
        `Valor tecnicamente devido: ${formatCurrency(technicalDueValue)}.`,
        `Valor glosável: ${formatCurrency(glosableValue)}.`,
        `Valor simulado para melhorias sem cobrança oficial: ${formatCurrency(simulatedValue)}.`,
        `Economia gerencial evidenciada: ${formatCurrency(glosableValue)} com percentual estimado de glosa de ${formatNumber(dashboard.glosaPercentage)}%.`,
      ],
    },
    {
      title: 'Principais divergências e riscos',
      items: divergenceItems.slice(0, 10).map(
        (row) => `${row.callCode} — ${row.title}: ${row.comparison}. Inconsistências: ${row.inconsistencies}. Recomendação: ${row.recommendation}.`,
      ),
    },
    {
      title: 'Limitações metodológicas',
      items: limitations.length
        ? limitations
        : ['Não foram identificadas limitações metodológicas relevantes além das inerentes ao material importado.'],
    },
    {
      title: 'Conclusão técnica consolidada',
      items: [
        'A análise utilizou critério conservador voltado à proteção do erário, reconhecendo pagamento automático apenas para melhorias evolutivas com suporte documental suficiente.',
        'Itens classificados como obrigação contratual, duplicidade, pendência ou caso misto sem segregação foram direcionados para glosa ou validação administrativa.',
        `Recomenda-se que o CRECI/PR concentre o pagamento nos ${payableItems.length} itens com evidência favorável e priorize a revisão dos ${pendingItems.length} itens pendentes.`,
      ],
    },
  ].map((section) => ({
    ...section,
    items: section.items.length ? section.items : ['Nenhum item relevante identificado nesta seção.'],
  }));

  const executiveSummary = [
    `${rows.length} demandas processadas com ${dashboard.billedValue > 0 ? 'valoração financeira' : 'foco técnico-documental'}.`,
    `${dashboard.contractualObligations} itens classificados como obrigação contratual, sem pagamento adicional.`,
    `${dashboard.evolutionaryImprovements} itens classificados como melhoria evolutiva, dos quais ${payableItems.length} estão recomendados para pagamento.`,
    `${pendingItems.length} itens exigem validação administrativa complementar.`,
    `${formatCurrency(glosableValue)} é o valor potencialmente glosável na análise atual.`,
  ];

  const calculationMemo = [
    {
      title: 'Horas técnicas',
      formula: 'Minutos informados ÷ 60',
      result: `${formatNumber(sum(rows.map((row) => row.timeMinutes)))} min = ${formatNumber(sum(rows.map((row) => row.timeHours)))} h`,
    },
    {
      title: 'Valor cobrado pela SCIRE',
      formula: 'Horas apresentadas × valor/hora informado ou vigente',
      result: formatCurrency(billedValue),
    },
    {
      title: 'Valor tecnicamente devido',
      formula: 'Horas reconhecidas como melhoria evolutiva × valor/hora contratual',
      result: formatCurrency(technicalDueValue),
    },
    {
      title: 'Valor glosável',
      formula: 'Valor cobrado pela SCIRE - valor tecnicamente devido',
      result: formatCurrency(glosableValue),
    },
    {
      title: 'Valor simulado',
      formula: 'Horas de melhorias identificadas sem cobrança oficial × valor/hora contratual',
      result: formatCurrency(simulatedValue),
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      ...settings,
      hourlyRate: appliedRate,
    },
    rows,
    processedFiles: parsedFiles,
    alerts: [...alerts, ...invalidFileWarnings, ...textlessPdfWarnings],
    limitations,
    dashboard,
    reportSections,
    executiveSummary,
    calculationMemo,
    contractInsights,
    payableItems,
    glosableItems,
    pendingItems,
    divergenceItems,
    duplicateItems,
  };
}