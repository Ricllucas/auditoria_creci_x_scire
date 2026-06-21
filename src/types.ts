export type UploadSectionId = 'userBase' | 'creciCalls' | 'scireCalls' | 'contracts';

export type DemandOrigin = 'SCIRE' | 'CRECI/PR' | 'Ambas';

export type ComparisonStatus =
  | 'Convergente'
  | 'Divergente por departamento'
  | 'Divergente por CPF'
  | 'Divergente por usuário'
  | 'Divergente por descrição'
  | 'Ausente na SCIRE'
  | 'Ausente no CRECI/PR'
  | 'Duplicado'
  | 'Parcialmente convergente'
  | 'Pendente de validação';

export type ContractualClassification =
  | 'Obrigação Contratual'
  | 'Melhoria Evolutiva'
  | 'Misto / Revisão Necessária'
  | 'Pendente de Validação'
  | 'Duplicidade'
  | 'Fora do Escopo Documental Disponível';

export type ConfidenceLevel = 'Alta confiança' | 'Média confiança' | 'Baixa confiança';

export interface UploadSectionDefinition {
  id: UploadSectionId;
  title: string;
  description: string;
  acceptedExtensions: string[];
  riskMessage: string;
}

export interface UploadFileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  extension: string;
  importedAt: string;
  status: 'ready' | 'invalid';
  issue?: string;
}

export interface UploadSectionState {
  id: UploadSectionId;
  files: UploadFileItem[];
  confirmed: boolean;
  showFiles: boolean;
}

export interface ParsedInputRow {
  [key: string]: string | number | boolean | null;
}

export interface ParsedInputFile {
  fileId: string;
  sectionId: UploadSectionId;
  fileName: string;
  extension: string;
  importedAt: string;
  documentType: 'spreadsheet' | 'csv' | 'pdf' | 'docx' | 'doc' | 'unknown';
  status: 'parsed' | 'invalid';
  warnings: string[];
  textContent: string;
  rows: ParsedInputRow[];
  sheetNames: string[];
  pageCount?: number;
}

export interface CpfOverrideRule {
  id: string;
  cpf: string;
  userName: string;
  officialDepartment: string;
}

export interface AnalysisSettings {
  analysisLabel: string;
  periodStart: string;
  periodEnd: string;
  hourlyRate: number;
  useContractHourlyRate: boolean;
  conservativeMode: boolean;
  similarityThreshold: number;
}

export interface UserDirectoryEntry {
  cpf: string;
  cpfRaw: string;
  userName: string;
  department: string;
  sector: string;
  sourceFile: string;
}

export interface TicketRecord {
  origin: 'SCIRE' | 'CRECI/PR';
  sourceFile: string;
  code: string;
  title: string;
  description: string;
  openedAt: string;
  status: string;
  cpf: string;
  cpfRaw: string;
  userName: string;
  department: string;
  sector: string;
  minutes: number;
  hours: number;
  billedValue: number;
  hourlyRate: number;
  rawValues: ParsedInputRow;
}

export interface ContractInsight {
  sourceFile: string;
  kind:
    | 'hourly_rate'
    | 'continuous_obligation'
    | 'on_demand_service'
    | 'module'
    | 'payment_rule'
    | 'franchise_hours'
    | 'document_limit';
  label: string;
  excerpt: string;
  value?: number;
}

export interface AnalysisRow {
  id: string;
  period: string;
  sourceFileOrigin: string;
  callCode: string;
  title: string;
  summaryDescription: string;
  demandOrigin: DemandOrigin;
  callDate: string;
  status: string;
  cpf: string;
  identifiedUser: string;
  officialDepartment: string;
  officialSector: string;
  scireDepartment: string;
  comparison: ComparisonStatus;
  departmentCriterion: string;
  contractualClassification: ContractualClassification;
  classificationType: string;
  timeMinutes: number;
  timeHours: number;
  appliedHourlyRate: number;
  billedValue: number;
  technicalDueValue: number;
  glosableValue: number;
  simulatedValue: number;
  confidenceLevel: ConfidenceLevel;
  technicalBasis: string;
  contractualBasis: string;
  inconsistencies: string;
  recommendation: string;
  observations: string;
  probableDepartment: string;
}

export interface DashboardMetrics {
  totalDemands: number;
  scireDemands: number;
  creciDemands: number;
  bothBases: number;
  onlyScire: number;
  onlyCreci: number;
  contractualObligations: number;
  evolutionaryImprovements: number;
  mixedCases: number;
  pendingValidation: number;
  duplicates: number;
  billedValue: number;
  technicalDueValue: number;
  glosableValue: number;
  estimatedSavings: number;
  glosaPercentage: number;
  totalHoursScire: number;
  recognizedHours: number;
  glosableHours: number;
  simulatedValue: number;
  byDepartment: Array<{ name: string; total: number }>;
  byUser: Array<{ name: string; total: number }>;
  byStatus: Array<{ name: string; total: number }>;
  byConfidence: Array<{ name: string; total: number }>;
  byClassification: Array<{ name: string; total: number }>;
}

export interface ReportSection {
  title: string;
  items: string[];
}

export interface CalculationMemoEntry {
  title: string;
  formula: string;
  result: string;
}

export interface AnalysisResult {
  generatedAt: string;
  settings: AnalysisSettings;
  rows: AnalysisRow[];
  processedFiles: ParsedInputFile[];
  alerts: string[];
  limitations: string[];
  dashboard: DashboardMetrics;
  reportSections: ReportSection[];
  executiveSummary: string[];
  calculationMemo: CalculationMemoEntry[];
  contractInsights: ContractInsight[];
  payableItems: AnalysisRow[];
  glosableItems: AnalysisRow[];
  pendingItems: AnalysisRow[];
  divergenceItems: AnalysisRow[];
  duplicateItems: AnalysisRow[];
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'auditor';
  createdAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterPayload extends LoginCredentials {
  name: string;
}

export interface UploadFileSnapshot {
  id: string;
  name: string;
  size: number;
  type: string;
  extension: string;
  importedAt: string;
  status: 'ready' | 'invalid';
  issue?: string;
}

export interface UploadSectionSnapshot {
  id: UploadSectionId;
  confirmed: boolean;
  files: UploadFileSnapshot[];
}

export interface AnalysisSnapshot {
  generatedAt: string;
  settings: AnalysisSettings;
  sections: UploadSectionSnapshot[];
  result: AnalysisResult;
}

export interface SavedAnalysisSummary {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  createdAt: string;
  totalDemands: number;
  billedValue: number;
  technicalDueValue: number;
  glosableValue: number;
}

export interface SavedAnalysisRecord extends SavedAnalysisSummary {
  snapshot: AnalysisSnapshot;
}