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
    return value.toISOString();
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

function normalizeRows(rows: Record<string, unknown>[], sheetName?: string): ParsedInputRow[] {
  return rows.map((row) => {
    const normalized: ParsedInputRow = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[key.trim() || 'coluna'] = stringifyRowValue(value);
    });
    if (sheetName) {
      normalized._planilha = sheetName;
    }
    return normalized;
  });
}

function parseCsv(text: string): ParsedInputRow[] {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });

  const data = parsed.data;
  if (!data.length) {
    return [];
  }

  const [headerRow, ...bodyRows] = data;
  const headers = headerRow.map((header, index) => header?.trim() || `coluna_${index + 1}`);

  return bodyRows.map((row) => {
    const entry: ParsedInputRow = {};
    headers.forEach((header, index) => {
      entry[header] = row[index]?.trim() ?? '';
    });
    return entry;
  });
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

async function parseSpreadsheet(file: File): Promise<{ rows: ParsedInputRow[]; sheetNames: string[] }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const rows: ParsedInputRow[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: '',
      raw: false,
    });
    rows.push(...normalizeRows(sheetRows, sheetName));
  });

  return {
    rows,
    sheetNames: workbook.SheetNames,
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
          const rows = parseCsv(text);
          return {
            fileId: item.id,
            sectionId,
            fileName: item.name,
            extension,
            importedAt: item.importedAt,
            documentType,
            status: 'parsed' as const,
            warnings,
            textContent: [text, rowsToText(rows)].filter(Boolean).join('\n'),
            rows,
            sheetNames: [],
          };
        }

        if (documentType === 'spreadsheet') {
          const { rows, sheetNames } = await parseSpreadsheet(item.file);
          return {
            fileId: item.id,
            sectionId,
            fileName: item.name,
            extension,
            importedAt: item.importedAt,
            documentType,
            status: 'parsed' as const,
            warnings,
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
