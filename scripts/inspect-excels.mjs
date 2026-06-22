import XLSX from 'xlsx';

const files = [
  'C:/Users/ricll/Downloads/Base_Scire_melhorias .xlsx',
  'C:/Users/ricll/Downloads/chamados_sead.xlsx',
  'C:/Users/ricll/Downloads/chamados_suportes_fiscalizacao.xlsx',
  'C:/Users/ricll/Downloads/chamados_suportes_processos_disciplinares.xlsx',
  'C:/Users/ricll/Downloads/chamados_suportes_procuradoria_fiscal.xlsx',
  'C:/Users/ricll/Downloads/chamados_suportes_sead.xlsx',
  'C:/Users/ricll/Downloads/plano_acao.xls',
  'C:/Users/ricll/Downloads/3265.xls',
];

function toRows(worksheet, headerRow) {
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
    range: headerRow,
  });
}

function normalizeCell(value) {
  return String(value ?? '').trim();
}

const summaries = files.map((file) => {
  try {
    const workbook = XLSX.readFile(file, {
      cellDates: false,
      raw: false,
      dense: true,
    });

    return {
      file,
      sheets: workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const topRows = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          raw: false,
          defval: '',
          blankrows: false,
        })
          .slice(0, 8)
          .map((row) => row.slice(0, 12).map(normalizeCell));

        const headerCandidates = Array.from({ length: Math.min(6, topRows.length) }, (_, headerRow) => {
          const rows = toRows(worksheet, headerRow).slice(0, 4);
          const header = (rows[0] ?? []).slice(0, 15).map((cell, index) => normalizeCell(cell) || `__empty_${index}`);
          const preview = rows.slice(1, 3).map((row) =>
            Object.fromEntries(
              header.map((column, index) => [column, normalizeCell(row[index] ?? '')]).filter(([, value]) => value),
            ),
          );

          return {
            headerRow,
            columns: header,
            preview,
          };
        });

        return {
          sheetName,
          ref: worksheet['!ref'],
          topRows,
          headerCandidates,
        };
      }),
    };
  } catch (error) {
    return {
      file,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

console.log(JSON.stringify(summaries, null, 2));