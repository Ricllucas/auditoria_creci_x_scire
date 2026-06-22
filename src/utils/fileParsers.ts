import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import mammoth from 'mammoth/mammoth.browser';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { OcrProgressState, ParsedInputFile, ParsedInputRow, UploadFileItem, UploadSectionId } from '../types';

GlobalWorkerOptions.workerSrc = pdfWorker;

type OcrRecognitionResult = {
  data: {
    text: string;
  };
};

type OcrWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<OcrRecognitionResult>;
};

type TesseractModule = {
  createWorker: (languages?: string, oem?: number, options?: { logger?: (message: OcrLoggerMessage) => void }) => Promise<OcrWorker>;
};

let ocrWorkerPromise: Promise<OcrWorker> | null = null;
let ocrQueue: Promise<void> = Promise.resolve();

type OcrLoggerMessage = {
  progress: number;
  status: string;
};

type ParseFileOptions = {
  onOcrProgress?: (state: OcrProgressState | null) => void;
};

function stringifyRowValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }

  return String(value).trim();
}

function rowsToText(rows: ParsedInputRow[]): string {
  return rows
    .map((row) =>
      Object.entries(row)
        .filter(([, value]) => value !== null && value !== '')
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(' | '),
    )
    .join('\n');
}


type MatrixRow = string[];

type SpreadsheetTemplate = {
  dataKinds: Array<'id' | 'text' | 'cpf' | 'date' | 'time' | 'number' | 'status' | 'optionalText' | 'optionalStatus'>;
  headerKeywords: string[][];
  headers: string[];
  id: string;
  minimumDataScore: number;
  minimumHeaderScore: number;
  sectionIds: UploadSectionId[];
};

type MatrixParseResult = {
  rows: ParsedInputRow[];
  warnings: string[];
};

const CALL_SECTION_IDS: UploadSectionId[] = ['creciCalls', 'scireCalls'];

const SPREADSHEET_TEMPLATES: SpreadsheetTemplate[] = [
  {
    id: 'detailed_support_7',
    sectionIds: CALL_SECTION_IDS,
    headers: ['Suporte', 'Titulo', 'Descricao', 'Documento', 'Data', 'Hora', 'Tempo (Min.)'],
    headerKeywords: [
      ['suporte', 'codigo', 'código', 'chamado', 'ticket'],
      ['titulo', 'título', 'assunto'],
      ['descricao', 'descrição', 'detalhe', 'demanda'],
      ['documento', 'cpf'],
      ['data'],
      ['hora'],
      ['tempo', 'min'],
    ],
    dataKinds: ['id', 'text', 'text', 'cpf', 'date', 'time', 'number'],
    minimumHeaderScore: 10,
    minimumDataScore: 4,
  },
  {
    id: 'support_with_user_7',
    sectionIds: CALL_SECTION_IDS,
    headers: ['Suporte', 'Título', 'Data', 'Hora', 'Usuário', 'Situação', 'Status'],
    headerKeywords: [
      ['suporte', 'codigo', 'código', 'chamado'],
      ['titulo', 'título', 'assunto'],
      ['data'],
      ['hora'],
      ['usuario', 'usuário', 'solicitante'],
      ['situacao', 'situação'],
      ['status'],
    ],
    dataKinds: ['id', 'text', 'date', 'time', 'optionalText', 'optionalStatus', 'status'],
    minimumHeaderScore: 8,
    minimumDataScore: 5,
  },
  {
    id: 'support_with_department_6',
    sectionIds: CALL_SECTION_IDS,
    headers: ['Código', 'Título', 'Data', 'Hora', 'Status', 'Departamento'],
    headerKeywords: [
      ['codigo', 'código', 'suporte', 'chamado'],
      ['titulo', 'título', 'assunto'],
      ['data'],
      ['hora'],
      ['status', 'situacao', 'situação'],
      ['departamento', 'setor'],
    ],
    dataKinds: ['id', 'text', 'date', 'time', 'status', 'optionalText'],
    minimumHeaderScore: 8,
    minimumDataScore: 5,
  },
  {
    id: 'support_with_department_5',
    sectionIds: CALL_SECTION_IDS,
    headers: ['Suporte', 'Título', 'Data', 'Hora', 'Departamento'],
    headerKeywords: [
      ['suporte', 'codigo', 'código', 'chamado'],
      ['titulo', 'título', 'assunto'],
      ['data'],
      ['hora'],
      ['departamento', 'setor'],
    ],
    dataKinds: ['id', 'text', 'date', 'time', 'text'],
    minimumHeaderScore: 7,
    minimumDataScore: 4,
  },
  {
    id: 'official_users_4',
    sectionIds: ['userBase'],
    headers: ['CPF', 'Usuário', 'Departamento', 'Setor'],
    headerKeywords: [
      ['cpf', 'documento', 'cpf/cnpj'],
      ['usuario', 'usuário', 'nome'],
      ['departamento', 'delegacia', 'lotacao', 'lotação'],
      ['setor', 'subsetor'],
    ],
    dataKinds: ['cpf', 'text', 'text', 'optionalText'],
    minimumHeaderScore: 6,
    minimumDataScore: 3,
  },
];

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimTrailingEmptyCells(row: MatrixRow): MatrixRow {
  let end = row.length;
  while (end > 0 && !row[end - 1]) {
    end -= 1;
  }
  return row.slice(0, end);
}

function matrixFromUnknownRows(rows: unknown[][]): MatrixRow[] {
  return rows
    .filter((row) => Array.isArray(row))
    .map((row) => trimTrailingEmptyCells(row.map((value) => stringifyRowValue(value).replace(/\r/g, '\n').trim())))
    .filter((row) => row.some(Boolean));
}

function isCpfLike(value: string): boolean {
  return /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/.test(value);
}

function isDateLike(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+a\s+\d{1,2}\/\d{1,2}\/\d{2,4})?$/i.test(trimmed) ||
    /^\d{1,2}\/\d{4}$/i.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}/.test(trimmed)
  );
}

function isTimeLike(value: string): boolean {
  return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value.trim());
}

function isNumericLike(value: string): boolean {
  const trimmed = value.trim();
  return /^\d+(?:[.,]\d+)?$/.test(trimmed) || /^\d{1,3}(?:[.,]\d{3})+$/.test(trimmed);
}

function isStatusLike(value: string): boolean {
  return /\b(aberto|aberta|encerrado|encerrada|fechado|fechada|cliente|suporte|pendente|concluido|concluído|em andamento)\b/i.test(
    value,
  );
}

function headerCellMatchesKeywords(value: string, keywords: string[]): boolean {
  const normalized = normalizeKey(value);
  return keywords.some((keyword) => normalized.includes(normalizeKey(keyword)));
}

function matchesDataKind(value: string, kind: SpreadsheetTemplate['dataKinds'][number]): boolean {
  const trimmed = value.trim();

  if (kind === 'optionalText' || kind === 'optionalStatus') {
    if (!trimmed) {
      return true;
    }
    return matchesDataKind(trimmed, kind === 'optionalText' ? 'text' : 'status');
  }

  if (!trimmed) {
    return false;
  }

  switch (kind) {
    case 'cpf':
      return isCpfLike(trimmed);
    case 'date':
      return isDateLike(trimmed);
    case 'time':
      return isTimeLike(trimmed);
    case 'number':
      return isNumericLike(trimmed);
    case 'status':
      return isStatusLike(trimmed) || trimmed.length <= 24;
    case 'id':
      return !isCpfLike(trimmed) && !isDateLike(trimmed) && !isTimeLike(trimmed) && trimmed.length <= 48;
    case 'text':
      return !isDateLike(trimmed) && !isTimeLike(trimmed) && trimmed.length >= 2;
    default:
      return false;
  }
}

function scoreHeaderRow(row: MatrixRow, template: SpreadsheetTemplate): number {
  let score = 0;
  template.headers.forEach((_, index) => {
    const cell = row[index] ?? '';
    if (headerCellMatchesKeywords(cell, template.headerKeywords[index])) {
      score += 3;
      return;
    }

    if (!cell) {
      return;
    }

    if (matchesDataKind(cell, template.dataKinds[index])) {
      score -= 1;
    }
  });

  if (Math.abs(row.length - template.headers.length) <= 1) {
    score += 1;
  }

  return score;
}

function scoreDataRow(row: MatrixRow, template: SpreadsheetTemplate): number {
  let score = 0;
  template.dataKinds.forEach((kind, index) => {
    const cell = row[index] ?? '';
    if (matchesDataKind(cell, kind)) {
      score += 1;
    }
  });
  return score;
}

function findHeaderTemplate(matrix: MatrixRow[], sectionId: UploadSectionId):
  | { rowIndex: number; score: number; template: SpreadsheetTemplate }
  | null {
  const templates = SPREADSHEET_TEMPLATES.filter((template) => template.sectionIds.includes(sectionId));
  let bestMatch: { rowIndex: number; score: number; template: SpreadsheetTemplate } | null = null;

  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 6); rowIndex += 1) {
    templates.forEach((template) => {
      const score = scoreHeaderRow(matrix[rowIndex], template);
      if (score >= template.minimumHeaderScore && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { rowIndex, score, template };
      }
    });
  }

  return bestMatch;
}

function findDataTemplate(matrix: MatrixRow[], sectionId: UploadSectionId):
  | { rowIndex: number; score: number; template: SpreadsheetTemplate }
  | null {
  const templates = SPREADSHEET_TEMPLATES.filter((template) => template.sectionIds.includes(sectionId));
  let bestMatch: { rowIndex: number; score: number; template: SpreadsheetTemplate } | null = null;

  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 4); rowIndex += 1) {
    templates.forEach((template) => {
      const score = scoreDataRow(matrix[rowIndex], template);
      if (score >= template.minimumDataScore && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { rowIndex, score, template };
      }
    });
  }

  return bestMatch;
}

function createRowFromTemplate(row: MatrixRow, template: SpreadsheetTemplate, sheetName: string): ParsedInputRow {
  const entry: ParsedInputRow = {};

  template.headers.forEach((header, index) => {
    entry[header] = row[index] ?? '';
  });

  row.slice(template.headers.length).forEach((value, index) => {
    if (value) {
      entry[`extra_${index + 1}`] = value;
    }
  });

  entry._planilha = sheetName;
  return entry;
}

const TOTALIZER_PATTERNS = [
  /^total\s+em\s+horas?/i,
  /^total\s+em\s+minutos?/i,
  /^total\s+para\s+faturamento/i,
  /^total\s+geral/i,
  /^grand\s*total/i,
  /^subtotal$/i,
];

function isTotalizerRow(row: MatrixRow): boolean {
  // Only check the first two cells — totalizer labels appear in the leftmost columns
  return row.slice(0, 2).some((cell) => TOTALIZER_PATTERNS.some((pattern) => pattern.test(cell.trim())));
}

function addMinuteStrings(a: string, b: string): string {
  const parse = (s: string): number => {
    const cleaned = s.trim().replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    return Number(cleaned) || 0;
  };
  return String(parse(a) + parse(b));
}

function parseRowsByTemplate(
  matrix: MatrixRow[],
  template: SpreadsheetTemplate,
  startRowIndex: number,
  sheetName: string,
): ParsedInputRow[] {
  const isCallTemplate = template.sectionIds.some((id) => (CALL_SECTION_IDS as string[]).includes(id));
  const minutesColIndex = isCallTemplate ? template.dataKinds.lastIndexOf('number') : -1;

  const processedRows: MatrixRow[] = [];

  for (const row of matrix.slice(startRowIndex)) {
    if (isTotalizerRow(row)) continue;

    const col0 = (row[0] ?? '').trim();

    if (isCallTemplate && !col0) {
      // Linha de continuação de descrição — sem novo código de suporte.
      // Acumula seus minutos no chamado anterior em vez de criar um registro extra.
      if (processedRows.length > 0 && minutesColIndex >= 0) {
        const prev = processedRows[processedRows.length - 1];
        const updated = [...prev] as MatrixRow;
        updated[minutesColIndex] = addMinuteStrings(
          (prev[minutesColIndex] ?? '').toString(),
          (row[minutesColIndex] ?? '').toString(),
        );
        processedRows[processedRows.length - 1] = updated;
      }
      continue;
    }

    processedRows.push([...row] as MatrixRow);
  }

  return processedRows
    .filter((row) => scoreDataRow(row, template) >= template.minimumDataScore)
    .map((row) => createRowFromTemplate(row, template, sheetName));
}

function detectGenericHeaderRow(matrix: MatrixRow[]): number {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 6); rowIndex += 1) {
    const row = matrix[rowIndex];
    const nonEmpty = row.filter(Boolean);
    const textual = nonEmpty.filter((cell) => !isDateLike(cell) && !isTimeLike(cell) && !isNumericLike(cell)).length;
    const score = textual * 2 - (nonEmpty.length - textual);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }

  return bestIndex;
}

function buildGenericRows(matrix: MatrixRow[], sheetName: string): ParsedInputRow[] {
  if (!matrix.length) {
    return [];
  }

  const headerRowIndex = detectGenericHeaderRow(matrix);
  const headerRow = matrix[headerRowIndex] ?? [];
  const normalizedHeaders = headerRow.map((header, index) => {
    const cleaned = header.trim();
    return cleaned || `coluna_${index + 1}`;
  });

  return matrix.slice(headerRowIndex + 1).map((row) => {
    const entry: ParsedInputRow = {};
    normalizedHeaders.forEach((header, index) => {
      entry[header] = row[index] ?? '';
    });
    entry._planilha = sheetName;
    return entry;
  });
}

function isSummarySheet(sectionId: UploadSectionId, sheetName: string, matrix: MatrixRow[]): boolean {
  if (!CALL_SECTION_IDS.includes(sectionId)) {
    return false;
  }

  const normalizedName = normalizeKey(sheetName);
  const firstRowText = normalizeKey((matrix[0] ?? []).join(' '));
  return normalizedName.includes('resumo') || firstRowText.includes('resumo dos chamados');
}

function parseMatrixContent(matrix: MatrixRow[], sectionId: UploadSectionId, sheetName: string): MatrixParseResult {
  if (!matrix.length) {
    return { rows: [], warnings: [] };
  }

  if (isSummarySheet(sectionId, sheetName, matrix)) {
    return {
      rows: [],
      warnings: [`Planilha "${sheetName}" ignorada por conter apenas resumo estatístico.`],
    };
  }

  const dataTemplate = findDataTemplate(matrix, sectionId);
  const headerTemplate = findHeaderTemplate(matrix, sectionId);

  if (dataTemplate && (!headerTemplate || dataTemplate.score >= headerTemplate.score)) {
    return {
      rows: parseRowsByTemplate(matrix, dataTemplate.template, dataTemplate.rowIndex, sheetName),
      warnings: [],
    };
  }

  if (headerTemplate) {
    return {
      rows: parseRowsByTemplate(matrix, headerTemplate.template, headerTemplate.rowIndex + 1, sheetName),
      warnings: [],
    };
  }

  if (CALL_SECTION_IDS.includes(sectionId)) {
    return {
      rows: [],
      warnings: [`Planilha "${sheetName}" ignorada porque o layout de chamados não foi reconhecido automaticamente.`],
    };
  }

  return {
    rows: buildGenericRows(matrix, sheetName),
    warnings: [],
  };
}

function parseCsv(text: string, sectionId: UploadSectionId, sheetName: string): MatrixParseResult {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });

  const matrix = matrixFromUnknownRows(parsed.data);
  return parseMatrixContent(matrix, sectionId, sheetName);
}

function cleanPdfText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractTextFromPdfContent(content: { items: Array<{ str?: string; transform?: number[] }> }): string {
  const lines: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];

  content.items.forEach((item) => {
    if (typeof item.str !== 'string') {
      return;
    }

    const text = item.str.replace(/\s+/g, ' ').trim();
    if (!text) {
      return;
    }

    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = typeof transform[4] === 'number' ? transform[4] : 0;
    const y = typeof transform[5] === 'number' ? transform[5] : 0;
    const existingLine = lines.find((line) => Math.abs(line.y - y) <= 3);

    if (existingLine) {
      existingLine.items.push({ x, text });
      return;
    }

    lines.push({
      y,
      items: [{ x, text }],
    });
  });

  return cleanPdfText(
    lines
      .sort((left, right) => right.y - left.y)
      .map((line) =>
        line.items
          .sort((left, right) => left.x - right.x)
          .map((item) => item.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean)
      .join('\n'),
  );
}

function shouldRunOcrOnText(text: string): boolean {
  const normalized = cleanPdfText(text);
  if (!normalized) {
    return true;
  }

  const alphaNumericCount = normalized.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return alphaNumericCount < 40 || wordCount < 10;
}

async function getOcrWorker(logger?: (message: OcrLoggerMessage) => void): Promise<OcrWorker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import('tesseract.js').then(async (tesseractModule) => {
      const module = tesseractModule as unknown as TesseractModule;
      return module.createWorker('por+eng', undefined, logger ? { logger } : undefined);
    });
  }

  return ocrWorkerPromise;
}

async function runQueuedOcr<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = ocrQueue.then(task, task);
  ocrQueue = nextTask.then(
    () => undefined,
    () => undefined,
  );
  return nextTask;
}

async function renderPdfPageToCanvas(page: {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
    promise: Promise<void>;
  };
}): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Não foi possível preparar o canvas para OCR.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  return canvas;
}

async function runOcrOnPdfPage(page: {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
    promise: Promise<void>;
  };
}, logger?: (message: OcrLoggerMessage) => void): Promise<string> {
  return runQueuedOcr(async () => {
    const worker = await getOcrWorker(logger);
    const canvas = await renderPdfPageToCanvas(page);
    const result = await worker.recognize(canvas);
    return cleanPdfText(result.data.text);
  });
}

async function parsePdf(
  file: File,
  sectionId: UploadSectionId,
  options?: ParseFileOptions,
): Promise<{ text: string; pageCount: number; warnings: string[] }> {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];
  let usedOcrPages = 0;
  let failedOcrPages = 0;

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const extractedText = extractTextFromPdfContent(content as { items: Array<{ str?: string; transform?: number[] }> });

    if (!shouldRunOcrOnText(extractedText)) {
      pageTexts.push(extractedText);
      continue;
    }

    try {
      const ocrText = await runOcrOnPdfPage(page as never, (message) => {
        options?.onOcrProgress?.({
          sectionId,
          fileName: file.name,
          page: index,
          totalPages: pdf.numPages,
          progress: message.progress,
          overallProgress: ((index - 1) + message.progress) / pdf.numPages,
          status: message.status,
        });
      });
      if (ocrText) {
        usedOcrPages += 1;
        pageTexts.push(ocrText);
        continue;
      }
    } catch {
      failedOcrPages += 1;
    }

    pageTexts.push(extractedText);
  }

  options?.onOcrProgress?.(null);

  const warnings: string[] = [];
  if (usedOcrPages > 0) {
    warnings.push(`OCR aplicado em ${usedOcrPages} página(s) com baixa extração textual.`);
  }
  if (failedOcrPages > 0) {
    warnings.push(`OCR falhou em ${failedOcrPages} página(s); parte do conteúdo pode permanecer incompleta.`);
  }

  return {
    text: cleanPdfText(pageTexts.join('\n\n')),
    pageCount: pdf.numPages,
    warnings,
  };
}

async function parseSpreadsheet(file: File, sectionId: UploadSectionId): Promise<{ rows: ParsedInputRow[]; sheetNames: string[]; warnings: string[] }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const rows: ParsedInputRow[] = [];
  const warnings: string[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return;
    const matrix = matrixFromUnknownRows(
      XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false,
      }),
    );
    const parsedSheet = parseMatrixContent(matrix, sectionId, sheetName);
    rows.push(...parsedSheet.rows);
    warnings.push(...parsedSheet.warnings);
  });

  return {
    rows,
    sheetNames: workbook.SheetNames,
    warnings,
  };
}

function detectDocumentType(extension: string): ParsedInputFile['documentType'] {
  if (extension === 'csv') {
    return 'csv';
  }
  if (extension === 'xlsx' || extension === 'xls') {
    return 'spreadsheet';
  }
  if (extension === 'pdf') {
    return 'pdf';
  }
  if (extension === 'docx') {
    return 'docx';
  }
  if (extension === 'doc') {
    return 'doc';
  }
  return 'unknown';
}

export async function parseUploadedFiles(
  sectionId: UploadSectionId,
  files: UploadFileItem[],
  options?: ParseFileOptions,
): Promise<ParsedInputFile[]> {
  const parsedFiles = await Promise.all(
    files.map(async (item) => {
      const warnings: string[] = [];
      const extension = item.extension.toLowerCase();
      const documentType = detectDocumentType(extension);

      try {
        if (documentType === 'csv') {
          const text = await item.file.text();
          const parsedCsv = parseCsv(text, sectionId, 'CSV');
          return {
            fileId: item.id,
            sectionId,
            fileName: item.name,
            extension,
            importedAt: item.importedAt,
            documentType,
            status: 'parsed' as const,
            warnings: [...warnings, ...parsedCsv.warnings],
            textContent: [text, rowsToText(parsedCsv.rows)].filter(Boolean).join('\n'),
            rows: parsedCsv.rows,
            sheetNames: [],
          };
        }

        if (documentType === 'spreadsheet') {
          const { rows, sheetNames, warnings: spreadsheetWarnings } = await parseSpreadsheet(item.file, sectionId);
          return {
            fileId: item.id,
            sectionId,
            fileName: item.name,
            extension,
            importedAt: item.importedAt,
            documentType,
            status: 'parsed' as const,
            warnings: [...warnings, ...spreadsheetWarnings],
            textContent: rowsToText(rows),
            rows,
            sheetNames,
          };
        }

        if (documentType === 'pdf') {
          const { text, pageCount, warnings: pdfWarnings } = await parsePdf(item.file, sectionId, options);
          return {
            fileId: item.id,
            sectionId,
            fileName: item.name,
            extension,
            importedAt: item.importedAt,
            documentType,
            status: 'parsed' as const,
            warnings: text ? [...warnings, ...pdfWarnings] : [...pdfWarnings, 'O PDF foi lido, mas não apresentou texto extraível.'],
            textContent: text,
            rows: [],
            sheetNames: [],
            pageCount,
          };
        }

        if (documentType === 'docx') {
          const buffer = await item.file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer: buffer });
          return {
            fileId: item.id,
            sectionId,
            fileName: item.name,
            extension,
            importedAt: item.importedAt,
            documentType,
            status: 'parsed' as const,
            warnings,
            textContent: result.value.trim(),
            rows: [],
            sheetNames: [],
          };
        }

        if (documentType === 'doc') {
          return {
            fileId: item.id,
            sectionId,
            fileName: item.name,
            extension,
            importedAt: item.importedAt,
            documentType,
            status: 'invalid' as const,
            warnings: [
              'Arquivos .doc legados são aceitos para registro, mas a leitura textual direta no navegador não é suportada. Converta para DOCX ou PDF para análise completa.',
            ],
            textContent: '',
            rows: [],
            sheetNames: [],
          };
        }

        return {
          fileId: item.id,
          sectionId,
          fileName: item.name,
          extension,
          importedAt: item.importedAt,
          documentType,
          status: 'invalid' as const,
          warnings: ['Formato não suportado para leitura.'],
          textContent: '',
          rows: [],
          sheetNames: [],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha desconhecida';
        return {
          fileId: item.id,
          sectionId,
          fileName: item.name,
          extension,
          importedAt: item.importedAt,
          documentType,
          status: 'invalid' as const,
          warnings: [`Arquivo inválido, corrompido ou ilegível: ${message}`],
          textContent: '',
          rows: [],
          sheetNames: [],
        };
      }
    }),
  );

  return parsedFiles;
}
