import { AnalysisResult, AnalysisRow, ContractualClassification } from '../types';

export interface UnifiedReportDepartmentComparison {
  department: string;
  scireCount: number;
  scireHours: number;
  scireValue: number;
  creciCount: number;
  creciHours: number;
  creciValue: number;
  divergenceLabel: string;
}

export interface UnifiedReportDepartmentDistribution {
  department: string;
  totalOccurrences: number;
  contractualCount: number;
  improvementCount: number;
  contractualPercentage: number;
  improvementPercentage: number;
}

export interface UnifiedReportAnalyticRow {
  rowId: string;
  displayCode: string;
  title: string;
  requester: string;
  department: string;
  module: string;
  openedAt: string;
  status: string;
  framing: 'CONTRATUAL' | 'MELHORIA' | 'MISTO' | 'PENDENTE';
  scireHours: number;
  auditAction: string;
}

export interface UnifiedReportRecommendation {
  priority: string;
  description: string;
  reference: string;
  framing: 'CONTRATUAL' | 'MELHORIA' | 'MISTO' | 'PENDENTE';
}

export interface UnifiedTechnicalReportModel {
  title: string;
  subtitle: string;
  processReference: string;
  issuedAtLabel: string;
  presentationParagraphs: string[];
  totals: {
    totalDemands: number;
    closedSupport: number;
    openSupport: number;
    outsideSupport: number;
    scireClaimedCount: number;
    documentedCreciCount: number;
    mappedDivergences: number;
    estimatedGlosaValue: number;
    billedValue: number;
    dueValue: number;
    differenceBetweenClaimedAndDue: number;
    contractualFranchiseHours: number;
    contractualFranchiseValue: number;
    supplementaryHours: number;
    supplementaryValue: number;
  };
  departmentComparisons: UnifiedReportDepartmentComparison[];
  departmentDistribution: UnifiedReportDepartmentDistribution[];
  analyticRows: UnifiedReportAnalyticRow[];
  recommendations: UnifiedReportRecommendation[];
  conclusionParagraphs: string[];
}

const PROCESS_REFERENCE =
  'Processo Administrativo nº 2025.6.30071714 • Pregão Eletrônico nº 04/2025 (90004/2025)';
const BASE_CONTRACTUAL_HOURS = 684;
const DEPARTMENT_ORDER = [
  'SECRETARIA',
  'PROCESSOS DISCIPLINARES',
  'PROCURADORIA FISCAL',
  'FISCALIZAÇÃO',
  'OUVIDORIA',
  'PRESIDÊNCIA',
  'T.I.',
  'LICITAÇÃO',
  'PATRIMÔNIO',
  'JURÍDICO',
  'COORDENADORIA ADMINISTRATIVA',
  'SEAD',
  'NÃO INFORMADO',
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isClosedStatus(status: string): boolean {
  const normalized = normalizeText(status);
  return (
    normalized.includes('ENCERRADO') ||
    normalized.includes('FECHADO') ||
    normalized.includes('CONCLUIDO') ||
    normalized.includes('CONCLUÍDO')
  );
}

function isOpenSupportStatus(status: string): boolean {
  const normalized = normalizeText(status);
  return (
    normalized.includes('SUPORTE') ||
    normalized.includes('ABERTO') ||
    normalized.includes('ATENDIMENTO') ||
    normalized.includes('ANDAMENTO') ||
    normalized.includes('DESENVOLVIMENTO') ||
    normalized.includes('CLIENTE')
  );
}

function isOutsideSupportRow(row: AnalysisRow): boolean {
  const source = normalizeText(row.sourceFileOrigin);
  const code = normalizeText(row.callCode);
  return source.includes('FORA DO SISTEMA') || /^FISC\s*-\s*\d+/.test(code);
}

function resolveDepartment(row: AnalysisRow): string {
  const official = row.officialDepartment.trim();
  if (official && !official.toLowerCase().includes('pendente de validação')) {
    return official;
  }

  return row.probableDepartment || row.scireDepartment || 'Não informado';
}

function toDepartmentBucket(value: string): string {
  const normalized = normalizeText(value);
  if (normalized.includes('T I') || normalized === 'TI') {
    return 'T.I.';
  }
  if (normalized.includes('PROCESSOS DISCIPLINARES')) {
    return 'PROCESSOS DISCIPLINARES';
  }
  if (normalized.includes('PROCURADORIA FISCAL')) {
    return 'PROCURADORIA FISCAL';
  }
  if (normalized.includes('FISCALIZACAO')) {
    return 'FISCALIZAÇÃO';
  }
  if (normalized.includes('JURIDICO')) {
    return 'JURÍDICO';
  }
  if (normalized.includes('NAO INFORMADO') || normalized.includes('PENDENTE')) {
    return 'NÃO INFORMADO';
  }

  return value || 'Não informado';
}

function sortDepartments<T extends { department: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftIndex = DEPARTMENT_ORDER.indexOf(normalizeText(left.department));
    const rightIndex = DEPARTMENT_ORDER.indexOf(normalizeText(right.department));

    if (leftIndex >= 0 && rightIndex >= 0) {
      return leftIndex - rightIndex;
    }
    if (leftIndex >= 0) {
      return -1;
    }
    if (rightIndex >= 0) {
      return 1;
    }
    return left.department.localeCompare(right.department, 'pt-BR');
  });
}

function simplifyFraming(classification: ContractualClassification): UnifiedReportAnalyticRow['framing'] {
  if (classification === 'Obrigação Contratual') {
    return 'CONTRATUAL';
  }
  if (classification === 'Melhoria Evolutiva') {
    return 'MELHORIA';
  }
  if (classification === 'Misto / Revisão Necessária') {
    return 'MISTO';
  }
  return 'PENDENTE';
}

function inferModule(row: AnalysisRow): string {
  const text = normalizeText(`${row.title} ${row.summaryDescription}`);

  if (text.includes('OUVIDORIA')) {
    return 'Ouvidoria';
  }
  if (text.includes('RELATORIO') || text.includes('RELATÓRIO')) {
    return 'Relatórios Gerenciais';
  }
  if (text.includes('PRAZO')) {
    return 'Gestão de Prazos';
  }
  if (text.includes('FICHA CADASTRAL')) {
    return 'Ficha Cadastral';
  }
  if (text.includes('ASSINATURA')) {
    return 'Assinatura Digital';
  }
  if (text.includes('BLITZ') || text.includes('PLANO DE ACAO') || text.includes('PLANO DE AÇÃO')) {
    return 'Plano de Ação Fiscal';
  }
  if (text.includes('AUTO') || text.includes('FISCALIZATORIA') || text.includes('FISCALIZATÓRIA')) {
    return 'Ações Fiscalizatórias';
  }
  if (text.includes('DEBITO') || text.includes('DÉBITO') || text.includes('ANUIDADE')) {
    return 'Débitos e Anuidades';
  }
  if (text.includes('EMAIL') || text.includes('E MAIL') || text.includes('DOCUMENTO')) {
    return 'E-mails e Documentos';
  }
  if (text.includes('OS') || text.includes('ORDEM DE SERVICO') || text.includes('ORDEM DE SERVIÇO')) {
    return 'Ordens de Serviço';
  }

  return 'Módulo não identificado';
}

function buildAuditAction(row: AnalysisRow): string {
  if (isClosedStatus(row.status)) {
    return 'Nenhuma ação requerida, chamado de suporte encerrado.';
  }
  if (row.recommendation === 'Pagar') {
    return 'Validar aceite administrativo e consumir franquia contratual de horas técnicas.';
  }
  if (row.recommendation.includes('Glosar')) {
    return 'Submeter à glosa com fundamento técnico, documental e contratual.';
  }
  if (row.comparison === 'Ausente no CRECI/PR') {
    return 'Solicitar comprovação documental ou promover glosa integral por ausência de espelho interno.';
  }
  return 'Monitorar cumprimento do SLA pactuado.';
}

function buildDepartmentComparisons(rows: AnalysisRow[]): UnifiedReportDepartmentComparison[] {
  const departments = uniqueDepartmentList(rows);

  return sortDepartments(
    departments.map((department) => {
      const departmentRows = rows.filter((row) => toDepartmentBucket(resolveDepartment(row)) === department);
      const scireRows = departmentRows.filter((row) => row.demandOrigin === 'SCIRE' || row.demandOrigin === 'Ambas');
      const creciRows = departmentRows.filter((row) => row.demandOrigin === 'CRECI/PR' || row.demandOrigin === 'Ambas');
      const creciImprovementRows = creciRows.filter((row) => row.contractualClassification === 'Melhoria Evolutiva');
      const flaggedScireRows = scireRows.filter(
        (row) =>
          row.recommendation.includes('Glosar') ||
          row.comparison === 'Ausente no CRECI/PR' ||
          row.comparison === 'Divergente por departamento' ||
          row.comparison === 'Divergente por descrição',
      );

      const scireCount = scireRows.length;
      const creciCount = creciImprovementRows.length;
      const scireHours = sum(scireRows.map((row) => row.timeHours));
      const creciHours = sum(creciImprovementRows.map((row) => row.timeHours));
      const scireValue = sum(scireRows.map((row) => row.billedValue));
      const creciValue = sum(creciImprovementRows.map((row) => row.technicalDueValue + row.simulatedValue));
      const isCompatible =
        flaggedScireRows.length === 0 &&
        Math.abs(scireCount - creciCount) === 0 &&
        Math.abs(scireValue - creciValue) < 0.01;

      return {
        department,
        scireCount,
        scireHours,
        scireValue,
        creciCount,
        creciHours,
        creciValue,
        divergenceLabel: isCompatible ? '✅ COMPATÍVEL' : `⚠️ GLOSA: ${flaggedScireRows.length || scireCount} itens`,
      };
    }),
  );
}

function buildDepartmentDistribution(rows: AnalysisRow[]): UnifiedReportDepartmentDistribution[] {
  return sortDepartments(
    uniqueDepartmentList(rows).map((department) => {
      const departmentRows = rows.filter((row) => toDepartmentBucket(resolveDepartment(row)) === department);
      const contractualCount = departmentRows.filter((row) => row.contractualClassification === 'Obrigação Contratual').length;
      const improvementCount = departmentRows.filter((row) => row.contractualClassification === 'Melhoria Evolutiva').length;
      const totalOccurrences = departmentRows.length;
      const contractualPercentage = totalOccurrences ? (contractualCount / totalOccurrences) * 100 : 0;
      const improvementPercentage = totalOccurrences ? (improvementCount / totalOccurrences) * 100 : 0;

      return {
        department,
        totalOccurrences,
        contractualCount,
        improvementCount,
        contractualPercentage,
        improvementPercentage,
      };
    }),
  );
}

function uniqueDepartmentList(rows: AnalysisRow[]): string[] {
  return Array.from(
    new Set(
      rows.map((row) => toDepartmentBucket(resolveDepartment(row))),
    ),
  );
}

function buildAnalyticRows(rows: AnalysisRow[]): UnifiedReportAnalyticRow[] {
  return [...rows]
    .sort((left, right) => {
      const departmentCompare = toDepartmentBucket(resolveDepartment(left)).localeCompare(
        toDepartmentBucket(resolveDepartment(right)),
        'pt-BR',
      );
      if (departmentCompare !== 0) {
        return departmentCompare;
      }
      return left.callCode.localeCompare(right.callCode, 'pt-BR');
    })
    .map((row) => ({
      rowId: row.id,
      displayCode: row.callCode.startsWith('#') ? row.callCode : `#${row.callCode}`,
      title: `${row.title}${row.summaryDescription && row.summaryDescription !== row.title ? ` ↳ ${row.summaryDescription}` : ''}`,
      requester: row.identifiedUser,
      department: toDepartmentBucket(resolveDepartment(row)),
      module: inferModule(row),
      openedAt: row.callDate,
      status: row.status,
      framing: simplifyFraming(row.contractualClassification),
      scireHours: row.timeHours,
      auditAction: buildAuditAction(row),
    }));
}

function buildRecommendations(rows: AnalysisRow[]): UnifiedReportRecommendation[] {
  const priorityLabels = ['1 – URGENTE', '2 – URGENTE', '3 – ALTA', '4 – ALTA', '5 – MÉDIA', '6 – MÉDIA'];

  const ranked = [...rows]
    .sort((left, right) => scoreRowForPriority(right) - scoreRowForPriority(left))
    .slice(0, priorityLabels.length);

  return ranked.map((row, index) => ({
    priority: priorityLabels[index],
    description: row.title,
    reference: row.callCode || row.sourceFileOrigin,
    framing: simplifyFraming(row.contractualClassification),
  }));
}

function scoreRowForPriority(row: AnalysisRow): number {
  let score = row.glosableValue + row.timeHours;

  if (row.contractualClassification === 'Obrigação Contratual' && !isClosedStatus(row.status)) {
    score += 300;
  }
  if (row.contractualClassification === 'Melhoria Evolutiva' && !isClosedStatus(row.status)) {
    score += 260;
  }
  if (row.contractualClassification === 'Misto / Revisão Necessária') {
    score += 220;
  }
  if (row.recommendation.includes('Glosar')) {
    score += 180;
  }
  if (row.comparison === 'Ausente no CRECI/PR') {
    score += 160;
  }
  if (row.confidenceLevel === 'Baixa confiança') {
    score += 100;
  }

  return score;
}

export function buildUnifiedTechnicalReport(result: AnalysisResult): UnifiedTechnicalReportModel {
  const rows = result.rows;
  const issuedAt = new Date(result.generatedAt);
  const issuedAtLabel = Number.isNaN(issuedAt.getTime())
    ? result.generatedAt
    : issuedAt.toLocaleDateString('pt-BR');
  const departmentComparisons = buildDepartmentComparisons(rows);
  const departmentDistribution = buildDepartmentDistribution(rows);
  const analyticRows = buildAnalyticRows(rows);
  const scireRows = rows.filter((row) => row.demandOrigin === 'SCIRE' || row.demandOrigin === 'Ambas');
  const creciRows = rows.filter((row) => row.demandOrigin === 'CRECI/PR' || row.demandOrigin === 'Ambas');
  const closedSupport = rows.filter((row) => isClosedStatus(row.status)).length;
  const openSupport = rows.filter((row) => isOpenSupportStatus(row.status) && !isClosedStatus(row.status)).length;
  const outsideSupport = rows.filter((row) => isOutsideSupportRow(row)).length;
  const mappedDivergences = rows.filter(
    (row) => row.comparison !== 'Convergente' || row.recommendation.includes('Glosar'),
  ).length;
  const supplementaryHours = Math.max(0, result.dashboard.recognizedHours - BASE_CONTRACTUAL_HOURS);
  const contractualFranchiseValue = BASE_CONTRACTUAL_HOURS * result.settings.hourlyRate;
  const supplementaryValue = supplementaryHours * result.settings.hourlyRate;

  return {
    title: 'CRECI 6ª REGIÃO – PR',
    subtitle:
      'CONSELHO REGIONAL DE CORRETORES DE IMÓVEIS • CONSOLIDAÇÃO DE TODOS OS DEPARTAMENTOS DO CRECI-PR • RELATÓRIO TÉCNICO UNIFICADO',
    processReference: PROCESS_REFERENCE,
    issuedAtLabel,
    presentationParagraphs: [
      'Este relatório foi elaborado pelo Comitê Gestor de Fiscalização do CRECI/PR com o objetivo de consolidar, classificar e enquadrar contratualmente as demandas técnicas apresentadas pelos diversos departamentos do CRECI/PR e atendidas pelo Sistema de Gestão Integrada – SCIRE Tecnologia.',
      'A análise considera simultaneamente os documentos anexados pelo CRECI/PR, os registros apresentados pela SCIRE, a base oficial de usuários, os documentos contratuais vigentes e os chamados registrados pelos setores do Conselho, com confronto cruzado entre as bases para fins de glosa, validação e pagamento.',
      'Para cada demanda, o sistema identifica se a solicitação já estava prevista no escopo originalmente contratado [CONTRATUAL] ou se constitui melhoria, incremento funcional ou nova entrega tecnológica posterior [MELHORIA], sempre sob critério conservador de proteção do erário.',
      'Base documental considerada: Contrato Administrativo nº 2025.6.30071714; Termo de Referência; 1º Apostilamento; planilhas e relatórios de chamados apresentados pela SCIRE; registros e evidências documentais anexadas pelos departamentos do CRECI/PR.',
    ],
    totals: {
      totalDemands: rows.length,
      closedSupport,
      openSupport,
      outsideSupport,
      scireClaimedCount: scireRows.length,
      documentedCreciCount: creciRows.length,
      mappedDivergences,
      estimatedGlosaValue: result.dashboard.glosableValue,
      billedValue: result.dashboard.billedValue,
      dueValue: result.dashboard.technicalDueValue + result.dashboard.simulatedValue,
      differenceBetweenClaimedAndDue: result.dashboard.billedValue - (result.dashboard.technicalDueValue + result.dashboard.simulatedValue),
      contractualFranchiseHours: BASE_CONTRACTUAL_HOURS,
      contractualFranchiseValue,
      supplementaryHours,
      supplementaryValue,
    },
    departmentComparisons,
    departmentDistribution,
    analyticRows,
    recommendations: buildRecommendations(rows),
    conclusionParagraphs: [
      'Este Relatório Técnico Unificado estabelece balizamento normativo e salvaguarda financeira para a gestão transparente do contrato de tecnologia firmado pelo CRECI/PR com a SCIRE.',
      'Pelo método de auditoria preventiva, o sistema diferencia com critério técnico a manutenção corretiva ordinária, que deve ser suportada pela obrigação contratual da fornecedora, das melhorias sistêmicas legítimas que podem consumir franquia ou banco de horas quando devidamente comprovadas.',
      'Toda cobrança apresentada pela SCIRE deve guardar correspondência obrigatória com documentação física ou digital do CRECI/PR, evidência mínima de execução e aderência ao instrumento contratual aplicável ao período auditado.',
      'Na presente consolidação, recomenda-se pagamento apenas para itens classificados como melhoria evolutiva com respaldo documental suficiente, e glosa ou validação administrativa complementar para os demais itens.',
    ],
  };
}