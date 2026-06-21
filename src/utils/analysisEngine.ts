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
import { formatCurrency, formatNumber, formatDate, uniqueBy } from './format';

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  const asNumber = parseBrazilianNumber(normalized);
  return asNumber;
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

function extractUserDirectory(files: ParsedInputFile[]): UserDirectoryEntry[] {
  const rows = files.flatMap((file) => file.rows.map((row) => ({ row, fileName: file.fileName })));
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
  const textRows = files
    .filter((file) => !file.rows.length && file.textContent)
    .flatMap((file) =>
      file.textContent
        .split(/\n+/)
        .map((line) => ({
          sourceFile: file.fileName,
          row: {
            titulo: line.slice(0, 120),
            descricao: line,
          },
        })),
    );

  const tabularRows = files.flatMap((file) => file.rows.map((row) => ({ sourceFile: file.fileName, row })));

  return [...tabularRows, ...textRows]
    .map(({ row, sourceFile }) => {
      const code = firstFilled(row, ['codigo', 'código', 'chamado', 'ticket', 'protocolo', 'id']);
      const title = firstFilled(row, ['titulo', 'título', 'assunto', 'demanda', 'resumo']);
      const description = firstFilled(row, ['descricao', 'descrição', 'detalhe', 'historico', 'histórico', 'texto']);
      const openedAt = parseDateValue(firstFilled(row, ['data', 'abertura', 'criacao', 'criação', 'data abertura']));
      const status = firstFilled(row, ['status', 'situação', 'situacao', 'estado']);
      const cpfRaw = firstFilled(row, ['cpf', 'documento', 'doc']);
      const userName = firstFilled(row, ['usuario', 'usuário', 'solicitante', 'nome']);
      const department = firstFilled(row, ['departamento', 'depto', 'area', 'área', 'gerencia']);
      const sector = firstFilled(row, ['setor', 'secao', 'seção']);
      const minutes = parseMinutes(
        firstFilled(row, ['minutos', 'tempo', 'tempo tecnico', 'tempo técnico', 'duracao', 'duração']),
        firstFilled(row, ['horas', 'tempo horas', 'tempo em horas']),
      );
      const hourlyRate = parseBrazilianNumber(
        firstFilled(row, ['valor hora', 'valor/hora', 'vr hora', 'hora tecnica', 'hora técnica']),
      );
      const billedValue = parseBrazilianNumber(
        firstFilled(row, ['valor cobrado', 'valor', 'cobranca', 'cobrança', 'total cobrado', 'total']),
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
    const content = [file.textContent, ...file.rows.map((row) => Object.values(row).join(' '))]
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();

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
      const excerpt = content.slice(Math.max(0, index - 70), index + 120);
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
            excerpt: content.slice(Math.max(0, index - 70), index + 140),
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
  return [
    normalizeText(ticket.code),
    normalizeText(ticket.title),
    normalizeText(ticket.description).slice(0, 120),
    normalizeText(ticket.cpf),
    normalizeText(dateKey),
  ]
    .filter(Boolean)
    .join('|');
}

function baseKey(ticket: TicketRecord): string {
  if (ticket.code) {
    return `code:${normalizeText(ticket.code)}`;
  }

  return `sig:${signature(ticket)}`;
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
    creci.userName && scire.userName
      ? normalizeText(creci.userName) === normalizeText(scire.userName)
      : false;
  const departmentMatch =
    creci.department && scire.department
      ? normalizeText(creci.department) === normalizeText(scire.department)
      : false;
  const descriptionSimilarity = jaccardSimilarity(
    compactParts([creci.title, creci.description]),
    compactParts([scire.title, scire.description]),
  );

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

  const limitations = [
    ...alerts,
    ...invalidFileWarnings,
    ...(!fileGroups.contracts.length
      ? ['Sem documentos contratuais legíveis, a classificação poderá ficar limitada a critérios técnicos e conservadores.']
      : []),
  ];

  const userDirectory = extractUserDirectory(fileGroups.userBase);
  const creciTickets = extractTickets(fileGroups.creciCalls, 'CRECI/PR');
  const scireTickets = extractTickets(fileGroups.scireCalls, 'SCIRE');
  const contractInsights = extractContractInsights(fileGroups.contracts);
  const appliedRate = chooseApplicableHourlyRate(settings, contractInsights);

  const groups = new Map<
    string,
    {
      creci: TicketRecord[];
      scire: TicketRecord[];
    }
  >();

  [...creciTickets, ...scireTickets].forEach((ticket) => {
    const key = baseKey(ticket);
    const group = groups.get(key) ?? { creci: [], scire: [] };
    if (ticket.origin === 'CRECI/PR') {
      group.creci.push(ticket);
    } else {
      group.scire.push(ticket);
    }
    groups.set(key, group);
  });

  const rows: AnalysisRow[] = [...groups.entries()].map(([key, group], index) => {
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
      !representative?.minutes ||
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
    const billedValue =
      billedValueFromScire > 0
        ? billedValueFromScire
        : group.scire.length
          ? timeHours * sourceHourlyRate
          : 0;

    let technicalDueValue = 0;
    let simulatedValue = 0;

    if (classification === 'Melhoria Evolutiva' && confidence !== 'Baixa confiança') {
      if (group.scire.length) {
        technicalDueValue = timeHours * appliedRate;
      } else {
        simulatedValue = timeHours * appliedRate;
      }
    }

    if (classification === 'Misto / Revisão Necessária') {
      technicalDueValue = 0;
    }

    const glosableValue = Math.max(0, billedValue - technicalDueValue);
    const callDate = representative?.openedAt ? formatDate(representative.openedAt) : 'Não informado';
    const demandOrigin =
      group.creci.length && group.scire.length ? 'Ambas' : group.scire.length ? 'SCIRE' : 'CRECI/PR';
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
      comparison === 'Ausente no CRECI/PR'
        ? 'Cobrança sem espelho completo na base interna do CRECI/PR'
        : '',
      confidence === 'Baixa confiança'
        ? 'Elementos insuficientes para reconhecimento automático do valor devido'
        : '',
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
      id: key || String(index + 1),
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
      ]),
      probableDepartment: resolution.probableDepartment || representative?.department || '',
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
    (row) =>
      row.comparison !== 'Convergente' &&
      row.comparison !== 'Ausente na SCIRE' &&
      row.comparison !== 'Ausente no CRECI/PR',
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
        'Leitura dos arquivos anexados por seção, com extração de dados estruturados e texto livre.',
        'Cruzamento entre base oficial de usuários, chamados CRECI/PR, chamados SCIRE e documentos contratuais.',
        'Definição do departamento oficial com prevalência da base CRECI/PR e das redefinições administrativas de CPF.',
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
        (row) =>
          `${row.callCode} — ${row.title}: ${row.comparison}. Inconsistências: ${row.inconsistencies}. Recomendação: ${row.recommendation}.`,
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
        `A análise utilizou critério conservador voltado à proteção do erário, reconhecendo pagamento automático apenas para melhorias evolutivas com suporte documental suficiente.`,
        `Itens classificados como obrigação contratual, duplicidade, pendência ou caso misto sem segregação foram direcionados para glosa ou validação administrativa.`,
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
    alerts: [...alerts, ...invalidFileWarnings],
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
