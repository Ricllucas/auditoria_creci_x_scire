import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import mammoth from 'mammoth/mammoth.browser';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ParsedInputFile, ParsedInputRow, UploadFileItem, UploadSectionId } from '../types';

GlobalWorkerOptions.workerSrc = pdfWorker;

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

async function parsePdf(file: File): Promise<{ text: string; pageCount: number }> {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const lines: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];

    content.items.forEach((item) => {
      if (!('str' in item)) {
        return;
      }

      const text = item.str.replace(/\s+/g, ' ').trim();
      if (!text) {
        return;
      }

      const transform = 'transform' in item && Array.isArray(item.transform) ? item.transform : [];
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

    const text = lines
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
      .join('\n')
      .trim();

    pageTexts.push(text);
  }

  return {
    text: pageTexts.join('\n\n'),
    pageCount: pdf.numPages,
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
          const { text, pageCount } = await parsePdf(item.file);
          return {
            fileId: item.id,
            sectionId,
            fileName: item.name,
            extension,
            importedAt: item.importedAt,
            documentType,
            status: 'parsed' as const,
            warnings: text ? warnings : ['O PDF foi lido, mas não apresentou texto extraível.'],
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
