import { AnalysisSettings, CpfOverrideRule, UploadSectionDefinition } from './types';

export const STORAGE_KEYS = {
  settings: 'creci-scire-settings',
  overrides: 'creci-scire-overrides',
  savedAnalyses: 'creci-scire-saved-analyses',
} as const;

export const SECTION_DEFINITIONS: UploadSectionDefinition[] = [
  {
    id: 'userBase',
    title: 'Base de Usuários CRECI/PR',
    description:
      'Base oficial para definição de CPF, usuário, departamento e setor com prevalência sobre a SCIRE.',
    acceptedExtensions: ['pdf', 'xls', 'xlsx', 'csv'],
    riskMessage:
      'A ausência da base oficial de usuários pode comprometer a definição correta dos departamentos.',
  },
  {
    id: 'creciCalls',
    title: 'Chamados CRECI/PR',
    description:
      'Registros internos do CRECI/PR para comparação, divergências, pendências e ausência de cobrança.',
    acceptedExtensions: ['pdf', 'xls', 'xlsx', 'csv'],
    riskMessage:
      'A ausência da base de chamados internos pode impedir o confronto com registros do CRECI/PR.',
  },
  {
    id: 'scireCalls',
    title: 'Chamados SCIRE',
    description:
      'Chamados apresentados pela SCIRE com tempo técnico, CPF, título, descrição, situação e cobrança.',
    acceptedExtensions: ['pdf', 'xls', 'xlsx', 'csv'],
    riskMessage:
      'A ausência da base SCIRE pode impedir a análise dos itens efetivamente cobrados.',
  },
  {
    id: 'contracts',
    title: 'Contratos e Documentos Contratuais',
    description:
      'Contratos, termos, apostilamentos, aditivos e documentos usados para fundamentar escopo e valor/hora.',
    acceptedExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv'],
    riskMessage:
      'A ausência de documentos contratuais compromete a classificação entre obrigação contratual e melhoria.',
  },
];

export const DEFAULT_SETTINGS: AnalysisSettings = {
  analysisLabel: 'Auditoria CRECI/PR x SCIRE',
  periodStart: '',
  periodEnd: '',
  hourlyRate: 130,
  useContractHourlyRate: true,
  conservativeMode: true,
  similarityThreshold: 0.72,
};

export const DEFAULT_OVERRIDES: CpfOverrideRule[] = [
  ['101.534.869-61', 'Lucas Faria de Lima', 'Ouvidoria'],
  ['039.313.509-83', 'Elizangela Lazarin', 'Secretaria'],
  ['066.038.549-02', 'Arianne Nayara de Almeida', 'Secretaria'],
  ['061.491.369-14', 'Artur Guilherme de Góes Furtado', 'Processos Disciplinares'],
  ['875.009.659-15', 'Edson Gonçalves da Silva', 'Jurídico'],
  ['131.353.089-10', 'Guilherme Augusto Fabris', 'Jurídico'],
  ['120.269.079-35', 'Giovanna Moraes Giovanini', 'Secretaria'],
  ['038.158.459-39', 'Gisselli Antonietti', 'Secretaria'],
  ['098.360.659-54', 'Jessica Gabriele dos Santos Freitas', 'Secretaria'],
  ['497.941.368-40', 'Ketlin Yasmin Bandeira Bertoldo', 'Secretaria'],
  ['028.130.519-69', 'Marcia Helena Dias Farencena', 'Secretaria'],
  ['111.660.129-05', 'Mariane Cirino de Freitas', 'Secretaria'],
  ['013.341.139-71', 'Maurício Vogel Albino', 'Secretaria'],
  ['113.590.749-88', 'Mylena Freitas de Souza', 'Secretaria'],
  ['033.246.389-33', 'Sonia Maria Nadal Baran', 'Secretaria'],
  ['078.628.939-21', 'Thais Francine de Souza', 'Secretaria'],
  ['521.772.382-34', 'Thiago Cesar Soares Braga', 'Secretaria'],
  ['277.927.579-00', 'Vera Lúcia Luciano', 'Secretaria'],
  ['129.996.889-97', 'Vivian Mendes de Lima', 'Secretaria'],
].map(([cpf, userName, officialDepartment]) => ({
  id: crypto.randomUUID(),
  cpf,
  userName,
  officialDepartment,
}));

export const OBLIGATION_KEYWORDS = [
  'erro',
  'bug',
  'travamento',
  'falha',
  'lentidão',
  'indisponibilidade',
  'correção',
  'impressão',
  'certidão',
  'credencial',
  'formulário',
  'protocolo',
  'campo',
  'inconsistência',
  'integração',
  'webservice',
  'dados migrados',
  'implantação',
  'parametrização',
  'suporte',
  'manutenção',
  'assistência técnica',
  'recomposição',
  'ajuste',
];

export const IMPROVEMENT_KEYWORDS = [
  'novo módulo',
  'nova tela',
  'nova aba',
  'novo painel',
  'dashboard',
  'novo relatório',
  'novo filtro',
  'automação',
  'nova regra',
  'novo fluxo',
  'novo botão',
  'nova integração',
  'nova funcionalidade',
  'nova ferramenta',
  'ampliação',
  'novo recurso',
  'customização',
  'evolutiva',
  'melhoria',
];

export const GENERIC_TITLE_KEYWORDS = [
  'ajuste',
  'demanda',
  'chamado',
  'suporte',
  'solicitação',
  'pendência',
];
