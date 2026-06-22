import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AnalysisResult } from '../types';
import { downloadBlob, formatCurrency, formatDateTime, formatNumber } from './format';

function rowsToSheetData(result: AnalysisResult): Array<Record<string, string | number>> {
  return result.rows.map((row) => ({
    'Período da análise': row.period,
    'Origem do arquivo': row.sourceFileOrigin,
    'Código do chamado': row.callCode,
    'Título da demanda': row.title,
    'Descrição resumida': row.summaryDescription,
    'Origem da demanda': row.demandOrigin,
    'Data do chamado': row.callDate,
    'Situação do chamado': row.status,
    'CPF informado': row.cpf,
    'Usuário identificado': row.identifiedUser,
    'Departamento CRECI oficial': row.officialDepartment,
    'Setor CRECI oficial': row.officialSector,
    'Departamento SCIRE': row.scireDepartment,
    'Comparação CRECI x SCIRE': row.comparison,
    'Critério aplicado para definição do departamento': row.departmentCriterion,
    'Classificação contratual': row.contractualClassification,
    'Tipo de classificação': row.classificationType,
    'Tempo informado em minutos': row.timeMinutes,
    'Tempo convertido em horas': row.timeHours,
    'Valor/hora aplicado': row.appliedHourlyRate,
    'Valor cobrado pela SCIRE': row.billedValue,
    'Valor tecnicamente devido pelo CRECI/PR': row.technicalDueValue,
    'Valor glosável': row.glosableValue,
    'Valor simulado': row.simulatedValue,
    'Nível de confiança': row.confidenceLevel,
    'Fundamento técnico': row.technicalBasis,
    'Fundamento contratual': row.contractualBasis,
    'Inconsistências identificadas': row.inconsistencies,
    Recomendação: row.recommendation,
    Observações: row.observations,
  }));
}

export function exportAnalysisToExcel(result: AnalysisResult): void {
  const workbook = XLSX.utils.book_new();
  const summaryData = [
    ['Relatório', result.settings.analysisLabel],
    ['Gerado em', formatDateTime(result.generatedAt)],
    ['Valor/hora aplicado', formatCurrency(result.settings.hourlyRate)],
    ['Demandas analisadas', result.dashboard.totalDemands],
    ['Valor cobrado pela SCIRE', result.dashboard.billedValue],
    ['Valor tecnicamente devido', result.dashboard.technicalDueValue],
    ['Valor glosável', result.dashboard.glosableValue],
    ['Percentual de glosa', `${formatNumber(result.dashboard.glosaPercentage)}%`],
  ];

  const memoData = result.calculationMemo.map((item) => ({
    Título: item.title,
    Fórmula: item.formula,
    Resultado: item.result,
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rowsToSheetData(result)), 'Analitico');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryData), 'Resumo');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(memoData), 'MemoriaCalculo');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      result.reportSections.flatMap((section) =>
        section.items.map((item) => ({
          Seção: section.title,
          Conteúdo: item,
        })),
      ),
    ),
    'RelatorioTecnico',
  );

  if (result.unifiedReport) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        result.unifiedReport.departmentComparisons.map((item) => ({
          Departamento: item.department,
          'SCIRE Itens': item.scireCount,
          'SCIRE Horas': item.scireHours,
          'SCIRE Valor': item.scireValue,
          'CRECI Itens': item.creciCount,
          'CRECI Horas': item.creciHours,
          'CRECI Valor': item.creciValue,
          'Divergência / Glosa': item.divergenceLabel,
        })),
      ),
      'ComparativoSetores',
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        result.unifiedReport.analyticRows.map((item) => ({
          'ID / Chamado': item.displayCode,
          'Título e Detalhes': item.title,
          'Usuário Solicitante': item.requester,
          Departamento: item.department,
          Módulo: item.module,
          Abertura: item.openedAt,
          Situação: item.status,
          Enquadramento: item.framing,
          'Horas (SCIRE)': item.scireHours,
          'Ações de Auditoria': item.auditAction,
        })),
      ),
      'RelacaoAnaliticaUnificada',
    );
  }

  const buffer = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  });

  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `auditoria-creci-scire-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

export function exportAnalysisToPdf(result: AnalysisResult): void {
  const document = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const unified = result.unifiedReport;

  document.setFontSize(16);
  document.text(unified?.title || result.settings.analysisLabel, 40, 40);
  document.setFontSize(10);
  document.text(`Gerado em ${formatDateTime(result.generatedAt)}`, 40, 58);
  document.text(`Valor/hora aplicado: ${formatCurrency(result.settings.hourlyRate)}`, 40, 74);
  if (unified) {
    document.text(unified.processReference, 40, 90);
  }

  autoTable(document, {
    startY: unified ? 108 : 92,
    head: [['Indicador', 'Valor']],
    body: [
      ['Demandas analisadas', String(result.dashboard.totalDemands)],
      ['Valor cobrado pela SCIRE', formatCurrency(result.dashboard.billedValue)],
      ['Valor tecnicamente devido', formatCurrency(result.dashboard.technicalDueValue)],
      ['Valor glosável', formatCurrency(result.dashboard.glosableValue)],
      ['Percentual de glosa', `${formatNumber(result.dashboard.glosaPercentage)}%`],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [25, 45, 78] },
  });

  if (unified) {
    autoTable(document, {
      startY:
        ((document as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 140) + 18,
      head: [['Departamento', 'SCIRE', 'CRECI', 'Divergência / Glosa']],
      body: unified.departmentComparisons.map((item) => [
        item.department,
        `${item.scireCount} itens | ${formatNumber(item.scireHours)}h | ${formatCurrency(item.scireValue)}`,
        `${item.creciCount} itens | ${formatNumber(item.creciHours)}h | ${formatCurrency(item.creciValue)}`,
        item.divergenceLabel,
      ]),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [44, 85, 48] },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 170 },
        2: { cellWidth: 170 },
        3: { cellWidth: 130 },
      },
    });
  }

  autoTable(document, {
    startY: (document as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY
      ? ((document as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 120) + 18
      : 180,
    head: [
      [
        'ID / Chamado',
        'Título e Detalhes',
        'Usuário',
        'Departamento',
        'Módulo',
        'Situação',
        'Enquadramento',
        'Horas',
        'Ação de Auditoria',
      ],
    ],
    body: (unified?.analyticRows ?? []).slice(0, 40).map((row) => [
      row.displayCode,
      row.title,
      row.requester,
      row.department,
      row.module,
      row.status,
      row.framing,
      `${formatNumber(row.scireHours)}h`,
      row.auditAction,
    ]),
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [44, 85, 48] },
    columnStyles: {
      1: { cellWidth: 180 },
      2: { cellWidth: 100 },
      3: { cellWidth: 90 },
      4: { cellWidth: 95 },
      8: { cellWidth: 180 },
    },
  });

  let currentY =
    ((document as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 540) + 20;

  const reportSectionsToRender = unified
    ? [
        {
          title: 'Conclusão Administrativa e Diretriz de Conciliação',
          items: unified.conclusionParagraphs,
        },
      ]
    : result.reportSections.slice(0, 4);

  reportSectionsToRender.forEach((section) => {
    if (currentY > 520) {
      document.addPage();
      currentY = 40;
    }

    document.setFontSize(12);
    document.text(section.title, 40, currentY);
    currentY += 14;
    document.setFontSize(9);
    section.items.slice(0, 5).forEach((item) => {
      const lines = document.splitTextToSize(`• ${item}`, 760);
      document.text(lines, 50, currentY);
      currentY += lines.length * 11 + 4;
    });
    currentY += 8;
  });

  document.save(`auditoria-creci-scire-${new Date().toISOString().slice(0, 10)}.pdf`);
}