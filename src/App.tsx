import { useEffect, useMemo, useState } from 'react';
import { AuthPanel } from './components/auth/AuthPanel';
import { CpfOverridesTable } from './components/CpfOverridesTable';
import { Dashboard } from './components/Dashboard';
import { FileSection } from './components/FileSection';
import { ReportView } from './components/ReportView';
import { ResultsTable } from './components/ResultsTable';
import { SavedAnalysesPanel } from './components/SavedAnalysesPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { DEFAULT_OVERRIDES, DEFAULT_SETTINGS, SECTION_DEFINITIONS, STORAGE_KEYS } from './constants';
import {
  deleteSavedAnalysis,
  fetchCurrentUser,
  listSavedAnalyses,
  loadSavedAnalysis,
  loginUser,
  logoutUser,
  registerUser,
  saveAnalysisToApi,
} from './services/api';
import {
  AnalysisResult,
  AnalysisSettings,
  AnalysisSnapshot,
  AppUser,
  CpfOverrideRule,
  SavedAnalysisSummary,
  UploadFileItem,
  UploadSectionState,
} from './types';
import { runAuditAnalysis } from './utils/analysisEngine';
import { exportAnalysisToExcel, exportAnalysisToPdf } from './utils/exporters';
import { parseUploadedFiles } from './utils/fileParsers';
import { downloadBlob, formatCurrency, formatDateTime, safeJsonParse } from './utils/format';

function createInitialSections(): UploadSectionState[] {
  return SECTION_DEFINITIONS.map((definition) => ({
    id: definition.id,
    files: [],
    confirmed: false,
    showFiles: true,
  }));
}

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function createUploadFile(file: File, allowedExtensions: string[]): UploadFileItem {
  const extension = getExtension(file.name);
  const isValid = allowedExtensions.includes(extension);

  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    extension,
    importedAt: new Date().toISOString(),
    status: isValid ? 'ready' : 'invalid',
    issue: isValid ? undefined : `Formato .${extension || 'desconhecido'} não permitido nesta seção`,
  };
}

function buildAnalysisSnapshot(
  result: AnalysisResult,
  settings: AnalysisSettings,
  sections: UploadSectionState[],
): AnalysisSnapshot {
  return {
    generatedAt: result.generatedAt,
    settings,
    sections: sections.map((section) => ({
      id: section.id,
      confirmed: section.confirmed,
      files: section.files.map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        extension: file.extension,
        importedAt: file.importedAt,
        status: file.status,
        issue: file.issue,
      })),
    })),
    result,
  };
}

export default function App() {
  const [sections, setSections] = useState<UploadSectionState[]>(createInitialSections);
  const [settings, setSettings] = useState<AnalysisSettings>(() =>
    safeJsonParse(localStorage.getItem(STORAGE_KEYS.settings), DEFAULT_SETTINGS),
  );
  const [overrides, setOverrides] = useState<CpfOverrideRule[]>(() =>
    safeJsonParse(localStorage.getItem(STORAGE_KEYS.overrides), DEFAULT_OVERRIDES),
  );
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeView, setActiveView] = useState<'import' | 'results' | 'report'>('import');
  const [statusMessage, setStatusMessage] = useState('Pronto para receber arquivos e iniciar uma nova análise.');
  const [staleResults, setStaleResults] = useState(false);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysisSummary[]>([]);
  const [savedAnalysesLoading, setSavedAnalysesLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.overrides, JSON.stringify(overrides));
  }, [overrides]);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const user = await fetchCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : 'Falha ao validar sessão.');
      } finally {
        setAuthResolved(true);
      }
    };

    void initializeAuth();
  }, []);

  const refreshSavedAnalyses = async () => {
    if (!currentUser) {
      setSavedAnalyses([]);
      return;
    }

    setSavedAnalysesLoading(true);
    try {
      const analyses = await listSavedAnalyses();
      setSavedAnalyses(analyses);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Falha ao carregar análises salvas.');
    } finally {
      setSavedAnalysesLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      void refreshSavedAnalyses();
    } else {
      setSavedAnalyses([]);
    }
  }, [currentUser]);

  const sectionLookup = useMemo(
    () =>
      Object.fromEntries(
        SECTION_DEFINITIONS.map((definition) => [definition.id, definition]),
      ) as Record<(typeof SECTION_DEFINITIONS)[number]['id'], (typeof SECTION_DEFINITIONS)[number]>,
    [],
  );

  const hasFiles = sections.some((section) => section.files.length > 0);

  const updateSection = (
    sectionId: UploadSectionState['id'],
    updater: (section: UploadSectionState) => UploadSectionState,
  ) => {
    setSections((current) => current.map((section) => (section.id === sectionId ? updater(section) : section)));
  };

  const markDirty = () => {
    if (result) {
      setStaleResults(true);
      setStatusMessage('Os arquivos foram alterados. Reprocesse a análise para atualizar os resultados.');
    }
  };

  const handleAddFiles = (
    sectionId: UploadSectionState['id'],
    files: FileList | null,
    mode: 'append' | 'replace',
  ) => {
    if (!files) {
      return;
    }

    const definition = sectionLookup[sectionId];
    const nextFiles = Array.from(files).map((file) => createUploadFile(file, definition.acceptedExtensions));

    updateSection(sectionId, (section) => ({
      ...section,
      files: mode === 'replace' ? nextFiles : [...section.files, ...nextFiles],
      confirmed: false,
    }));

    markDirty();
    setStatusMessage(`Arquivos atualizados na seção "${definition.title}".`);
  };

  const handleRemoveFile = (sectionId: UploadSectionState['id'], fileId: string) => {
    updateSection(sectionId, (section) => ({
      ...section,
      files: section.files.filter((file) => file.id !== fileId),
      confirmed: false,
    }));
    markDirty();
  };

  const handleClearSection = (sectionId: UploadSectionState['id']) => {
    updateSection(sectionId, (section) => ({
      ...section,
      files: [],
      confirmed: false,
    }));
    markDirty();
  };

  const handleToggleFiles = (sectionId: UploadSectionState['id']) => {
    updateSection(sectionId, (section) => ({
      ...section,
      showFiles: !section.showFiles,
    }));
  };

  const handleConfirmSection = (sectionId: UploadSectionState['id']) => {
    updateSection(sectionId, (section) => ({
      ...section,
      confirmed: true,
    }));
  };

  const processAnalysis = async () => {
    setIsProcessing(true);
    setStatusMessage('Processando arquivos, extraindo dados e cruzando evidências...');

    try {
      const parsedGroups = await Promise.all(sections.map((section) => parseUploadedFiles(section.id, section.files)));
      const parsedFiles = parsedGroups.flat();
      const analysis = runAuditAnalysis({
        sections,
        parsedFiles,
        settings,
        overrides,
      });

      setResult(analysis);
      setActiveView('results');
      setStaleResults(false);
      setStatusMessage(`Análise concluída com ${analysis.rows.length} demanda(s) processada(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido durante a análise.';
      setStatusMessage(`Falha ao executar a análise: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearAll = () => {
    setSections(createInitialSections());
    setResult(null);
    setActiveView('import');
    setStaleResults(false);
    setStatusMessage('Todas as seções foram limpas.');
  };

  const handleDownloadSnapshot = () => {
    if (!result) {
      return;
    }

    const snapshot = buildAnalysisSnapshot(result, settings, sections);
    downloadBlob(
      new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
      `auditoria-creci-scire-${new Date().toISOString().slice(0, 10)}.json`,
    );
  };

  const handlePersistAnalysis = async () => {
    if (!result || !currentUser) {
      return;
    }

    const snapshot = buildAnalysisSnapshot(result, settings, sections);
    try {
      await saveAnalysisToApi({
        name: settings.analysisLabel || 'Auditoria CRECI/PR x SCIRE',
        periodStart: settings.periodStart,
        periodEnd: settings.periodEnd,
        generatedAt: result.generatedAt,
        totalDemands: result.dashboard.totalDemands,
        billedValue: result.dashboard.billedValue,
        technicalDueValue: result.dashboard.technicalDueValue,
        glosableValue: result.dashboard.glosableValue,
        snapshot,
      });
      await refreshSavedAnalyses();
      setStatusMessage('Análise salva com sucesso no banco de dados.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Falha ao salvar análise no banco.');
    }
  };

  const handleOpenSavedAnalysis = async (id: string) => {
    try {
      const record = await loadSavedAnalysis(id);
      setResult(record.snapshot.result);
      setSettings(record.snapshot.settings);
      setActiveView('results');
      setStaleResults(false);
      setStatusMessage(`Análise histórica "${record.name}" carregada do banco de dados.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Falha ao abrir análise salva.');
    }
  };

  const handleDeleteSavedAnalysis = async (id: string) => {
    try {
      await deleteSavedAnalysis(id);
      await refreshSavedAnalyses();
      setStatusMessage('Análise excluída do banco de dados.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Falha ao excluir análise.');
    }
  };

  const handleLogin = async (credentials: { email: string; password: string }) => {
    setAuthLoading(true);
    try {
      const user = await loginUser(credentials);
      setCurrentUser(user);
      setStatusMessage(`Sessão iniciada para ${user.name}.`);
      return user;
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (payload: { name: string; email: string; password: string }) => {
    setAuthLoading(true);
    try {
      const user = await registerUser(payload);
      setCurrentUser(user);
      setStatusMessage(`Conta criada com sucesso para ${user.name}.`);
      return user;
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } finally {
      setCurrentUser(null);
      setResult(null);
      setActiveView('import');
      setSavedAnalyses([]);
      setStatusMessage('Sessão encerrada.');
    }
  };

  const parsedFileAlerts = useMemo(() => {
    if (!result) {
      return [];
    }

    return result.processedFiles.flatMap((file) => file.warnings.map((warning) => `${file.fileName}: ${warning}`));
  }, [result]);

  if (!authResolved) {
    return (
      <div className="auth-loading-shell">
        <div className="panel-card auth-loading-card">
          <h2>Inicializando ambiente seguro</h2>
          <p>Validando sessão, banco de dados e serviços da aplicação...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthPanel onLogin={handleLogin} onRegister={handleRegister} loading={authLoading} />;
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <span className="hero__eyebrow">Plataforma de auditoria preventiva e fiscalização contratual</span>
          <h1>CRECI/PR x SCIRE</h1>
          <p>
            Importe bases, contratos e chamados para classificar demandas, calcular valores, apontar glosas e gerar
            relatórios técnicos auditáveis.
          </p>
        </div>

        <div className="hero__status">
          <div className="hero__status-card">
            <span>Usuário autenticado</span>
            <strong>{currentUser.name}</strong>
            <small>
              {currentUser.email} · perfil {currentUser.role}
            </small>
          </div>
          <div className="hero__status-card">
            <span>Status atual</span>
            <strong>{isProcessing ? 'Em processamento' : staleResults ? 'Reprocessamento recomendado' : 'Pronto'}</strong>
          </div>
          <div className="hero__status-card">
            <span>Última atualização</span>
            <strong>{result ? formatDateTime(result.generatedAt) : 'Ainda não processado'}</strong>
          </div>
          <div className="hero__status-card">
            <span>Valor/hora em uso</span>
            <strong>{formatCurrency(result?.settings.hourlyRate ?? settings.hourlyRate)}</strong>
          </div>
        </div>
      </header>

      <section className="toolbar">
        <button type="button" className="button button--primary" onClick={processAnalysis} disabled={isProcessing || !hasFiles}>
          Executar análise
        </button>
        <button type="button" className="button" onClick={processAnalysis} disabled={isProcessing || !hasFiles}>
          Reprocessar análise
        </button>
        <button type="button" className="button" onClick={handleClearAll} disabled={isProcessing}>
          Limpar todos os arquivos
        </button>
        <button type="button" className="button" onClick={() => void handlePersistAnalysis()} disabled={!result || savedAnalysesLoading}>
          Salvar análise
        </button>
        <button type="button" className="button" onClick={handleDownloadSnapshot} disabled={!result}>
          Baixar snapshot
        </button>
        <button type="button" className="button" onClick={() => result && exportAnalysisToExcel(result)} disabled={!result}>
          Exportar Excel
        </button>
        <button type="button" className="button" onClick={() => result && exportAnalysisToPdf(result)} disabled={!result}>
          Exportar PDF
        </button>
        <button type="button" className="button" onClick={() => setActiveView('report')} disabled={!result}>
          Gerar Relatório Técnico
        </button>
        <button type="button" className="button" onClick={() => setActiveView('import')}>
          Voltar à importação
        </button>
        <button type="button" className="button button--danger" onClick={() => void handleLogout()}>
          Sair
        </button>
      </section>

      <section className="status-banner">
        <strong>{statusMessage}</strong>
        {staleResults && <span>Os resultados anteriores não devem ser considerados definitivos até novo processamento.</span>}
      </section>

      <div className="layout-grid">
        <div className="layout-main">
          <SavedAnalysesPanel
            analyses={savedAnalyses}
            loading={savedAnalysesLoading}
            onRefresh={refreshSavedAnalyses}
            onOpen={handleOpenSavedAnalysis}
            onDelete={handleDeleteSavedAnalysis}
          />

          {activeView === 'import' && (
            <>
              <SettingsPanel
                settings={settings}
                onChange={setSettings}
                sections={sections}
                definitions={SECTION_DEFINITIONS}
              />

              <div className="sections-grid">
                {SECTION_DEFINITIONS.map((definition) => {
                  const section = sections.find((item) => item.id === definition.id)!;
                  return (
                    <FileSection
                      key={definition.id}
                      definition={definition}
                      section={section}
                      onAddFiles={handleAddFiles}
                      onRemoveFile={handleRemoveFile}
                      onClearSection={handleClearSection}
                      onToggleFiles={handleToggleFiles}
                      onConfirmSection={handleConfirmSection}
                    />
                  );
                })}
              </div>

              <CpfOverridesTable rules={overrides} onChange={setOverrides} />
            </>
          )}

          {activeView === 'results' && result && (
            <>
              <Dashboard metrics={result.dashboard} />
              <ResultsTable rows={result.rows} />
            </>
          )}

          {activeView === 'report' && result && <ReportView result={result} />}
        </div>

        <aside className="layout-side">
          <section className="panel-card">
            <div className="panel-card__header">
              <div>
                <h2>Resumo executivo</h2>
                <p>Orientações rápidas para decisão administrativa e fiscalizatória.</p>
              </div>
            </div>

            {result ? (
              <>
                <ul className="side-list">
                  {result.executiveSummary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>

                <div className="summary-mini-grid">
                  <article className="summary-mini-card">
                    <span>Itens pagáveis</span>
                    <strong>{result.payableItems.length}</strong>
                  </article>
                  <article className="summary-mini-card">
                    <span>Itens glosáveis</span>
                    <strong>{result.glosableItems.length}</strong>
                  </article>
                  <article className="summary-mini-card">
                    <span>Pendentes</span>
                    <strong>{result.pendingItems.length}</strong>
                  </article>
                  <article className="summary-mini-card">
                    <span>Divergências</span>
                    <strong>{result.divergenceItems.length}</strong>
                  </article>
                </div>

                <div className="side-section">
                  <h3>Memória de cálculo</h3>
                  <ul className="side-list">
                    {result.calculationMemo.map((entry) => (
                      <li key={entry.title}>
                        <strong>{entry.title}:</strong> {entry.formula} = {entry.result}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="side-section">
                  <h3>Alertas e limitações</h3>
                  <ul className="side-list">
                    {[...result.alerts, ...parsedFileAlerts].slice(0, 12).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                    {!result.alerts.length && !parsedFileAlerts.length && (
                      <li>Nenhum alerta adicional relevante identificado na análise atual.</li>
                    )}
                  </ul>
                </div>

                <div className="side-section">
                  <h3>Documentos contratuais identificados</h3>
                  <ul className="side-list">
                    {result.contractInsights.slice(0, 10).map((item) => (
                      <li key={`${item.sourceFile}-${item.label}-${item.excerpt}`}>
                        <strong>{item.label}</strong> — {item.sourceFile}
                      </li>
                    ))}
                    {!result.contractInsights.length && (
                      <li>Nenhum trecho contratual estruturado foi identificado nos arquivos atuais.</li>
                    )}
                  </ul>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <p>
                  Anexe arquivos nas quatro seções, confirme os documentos e execute a análise para gerar painel,
                  tabela analítica, memória de cálculo, relatório técnico e exportações.
                </p>
                <ul className="side-list">
                  <li>O sistema aceita múltiplos PDFs, XLS, XLSX e CSV em todas as bases operacionais.</li>
                  <li>Documentos DOCX contratuais também são lidos no navegador.</li>
                  <li>Arquivos DOC legados ficam registrados, mas exigem conversão para leitura completa.</li>
                  <li>Agora as análises podem ser persistidas em banco de dados com login por usuário.</li>
                </ul>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}