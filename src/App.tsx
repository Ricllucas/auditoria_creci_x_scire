import { useEffect, useMemo, useState } from 'react';
import { CpfOverridesTable } from './components/CpfOverridesTable';
import { Dashboard } from './components/Dashboard';
import { FileSection } from './components/FileSection';
import { ReportView } from './components/ReportView';
import { ResultsTable } from './components/ResultsTable';
import { SavedAnalysesPanel } from './components/SavedAnalysesPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { DEFAULT_OVERRIDES, DEFAULT_SETTINGS, SECTION_DEFINITIONS, STORAGE_KEYS } from './constants';
import {
  AnalysisResult,
  AnalysisSettings,
  AnalysisSnapshot,
  CpfOverrideRule,
  OcrProgressState,
  SavedAnalysisRecord,
  SavedAnalysisSummary,
  UploadFileItem,
  UploadSectionId,
  UploadSectionState,
} from './types';
import { runAuditAnalysis } from './utils/analysisEngine';
import { exportAnalysisToExcel, exportAnalysisToPdf } from './utils/exporters';
import { parseUploadedFiles } from './utils/fileParsers';
import { downloadBlob, formatCurrency, formatDateTime, safeJsonParse } from './utils/format';
import {
  clearPersistentSection,
  loadPersistentSection,
  removePersistentFile,
  savePersistentFile,
} from './utils/persistentStorage';

const PERSISTENT_SECTION_IDS: UploadSectionId[] = ['userBase', 'contracts'];

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

function loadSavedAnalysisRecords(): SavedAnalysisRecord[] {
  return safeJsonParse<SavedAnalysisRecord[]>(localStorage.getItem(STORAGE_KEYS.savedAnalyses), []);
}

export default function App() {
  const [sections, setSections] = useState<UploadSectionState[]>(createInitialSections);
  const [settings, setSettings] = useState<AnalysisSettings>(() =>
    safeJsonParse(localStorage.getItem(STORAGE_KEYS.settings), DEFAULT_SETTINGS),
  );
  const [overrides, setOverrides] = useState<CpfOverrideRule[]>(() =>
    safeJsonParse(localStorage.getItem(STORAGE_KEYS.overrides), DEFAULT_OVERRIDES),
  );
  const [savedAnalysisRecords, setSavedAnalysisRecords] = useState<SavedAnalysisRecord[]>(loadSavedAnalysisRecords);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeView, setActiveView] = useState<'import' | 'results' | 'report'>('import');
  const [statusMessage, setStatusMessage] = useState('Pronto para receber arquivos e iniciar uma nova análise.');
  const [staleResults, setStaleResults] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgressState | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.overrides, JSON.stringify(overrides));
  }, [overrides]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.savedAnalyses, JSON.stringify(savedAnalysisRecords));
  }, [savedAnalysisRecords]);

  // Load persisted files (userBase + contracts) from IndexedDB on first render
  useEffect(() => {
    async function restorePersistentSections() {
      for (const sectionId of PERSISTENT_SECTION_IDS) {
        const items = await loadPersistentSection(sectionId);
        if (items.length > 0) {
          setSections((current) =>
            current.map((section) =>
              section.id === sectionId
                ? { ...section, files: items, confirmed: true, showFiles: true }
                : section,
            ),
          );
        }
      }
    }
    void restorePersistentSections();
  }, []);

  const sectionLookup = useMemo(
    () =>
      Object.fromEntries(
        SECTION_DEFINITIONS.map((definition) => [definition.id, definition]),
      ) as Record<(typeof SECTION_DEFINITIONS)[number]['id'], (typeof SECTION_DEFINITIONS)[number]>,
    [],
  );

  const hasFiles = sections.some((section) => section.files.length > 0);

  const savedAnalyses = useMemo<SavedAnalysisSummary[]>(
    () =>
      savedAnalysisRecords.map(({ snapshot, ...summary }) => ({
        ...summary,
      })),
    [savedAnalysisRecords],
  );

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

  const refreshSavedAnalyses = () => {
    setSavedAnalysisRecords(loadSavedAnalysisRecords());
    setStatusMessage('Histórico local atualizado a partir do navegador.');
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

    if (PERSISTENT_SECTION_IDS.includes(sectionId as UploadSectionId)) {
      if (mode === 'replace') {
        void clearPersistentSection(sectionId);
      }
      for (const item of nextFiles) {
        void savePersistentFile(sectionId, item);
      }
    }

    updateSection(sectionId, (section) => ({
      ...section,
      files: mode === 'replace' ? nextFiles : [...section.files, ...nextFiles],
      confirmed: false,
    }));

    markDirty();
    setStatusMessage(`Arquivos atualizados na seção "${definition.title}".`);
  };

  const handleRemoveFile = (sectionId: UploadSectionState['id'], fileId: string) => {
    if (PERSISTENT_SECTION_IDS.includes(sectionId as UploadSectionId)) {
      void removePersistentFile(sectionId, fileId);
    }
    updateSection(sectionId, (section) => ({
      ...section,
      files: section.files.filter((file) => file.id !== fileId),
      confirmed: false,
    }));
    markDirty();
  };

  const handleClearSection = (sectionId: UploadSectionState['id']) => {
    if (PERSISTENT_SECTION_IDS.includes(sectionId as UploadSectionId)) {
      void clearPersistentSection(sectionId);
    }
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
    setOcrProgress(null);
    setStatusMessage('Processando arquivos, extraindo dados e cruzando evidências...');

    try {
      const parsedGroups = await Promise.all(
        sections.map((section) =>
          parseUploadedFiles(section.id, section.files, {
            onOcrProgress: setOcrProgress,
          }),
        ),
      );
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
      setOcrProgress(null);
      setIsProcessing(false);
    }
  };

  const handleClearAll = () => {
    // Clear only temporary sections (creciCalls, scireCalls)
    // Persistent sections (userBase, contracts) remain loaded
    setSections((current) =>
      current.map((section) =>
        PERSISTENT_SECTION_IDS.includes(section.id as UploadSectionId)
          ? section
          : { ...section, files: [], confirmed: false },
      ),
    );
    setResult(null);
    setActiveView('import');
    setStaleResults(false);
    setStatusMessage(
      'Chamados limpos. Bases de usuários e contratos permanecem carregados para nova análise.',
    );
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

  const handlePersistAnalysis = () => {
    if (!result) {
      return;
    }

    const snapshot = buildAnalysisSnapshot(result, settings, sections);
    const record: SavedAnalysisRecord = {
      id: crypto.randomUUID(),
      name: settings.analysisLabel || 'Auditoria CRECI/PR x SCIRE',
      periodStart: settings.periodStart,
      periodEnd: settings.periodEnd,
      generatedAt: result.generatedAt,
      createdAt: new Date().toISOString(),
      totalDemands: result.dashboard.totalDemands,
      billedValue: result.dashboard.billedValue,
      technicalDueValue: result.dashboard.technicalDueValue,
      glosableValue: result.dashboard.glosableValue,
      snapshot,
    };

    setSavedAnalysisRecords((current) => [record, ...current]);
    setStatusMessage('Análise salva com sucesso no navegador deste computador.');
  };

  const handleOpenSavedAnalysis = (id: string) => {
    const record = savedAnalysisRecords.find((item) => item.id === id);
    if (!record) {
      setStatusMessage('Não foi possível localizar a análise salva selecionada.');
      return;
    }

    setResult(record.snapshot.result);
    setSettings(record.snapshot.settings);
    setActiveView('results');
    setStaleResults(false);
    setStatusMessage(`Análise histórica "${record.name}" carregada do navegador.`);
  };

  const handleDeleteSavedAnalysis = (id: string) => {
    setSavedAnalysisRecords((current) => current.filter((item) => item.id !== id));
    setStatusMessage('Análise excluída do histórico local deste navegador.');
  };

  const handleLoadSnapshotFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) {
      return;
    }

    try {
      const rawContent = await file.text();
      const snapshot = JSON.parse(rawContent) as AnalysisSnapshot;
      if (!snapshot.result || !snapshot.settings) {
        throw new Error('Arquivo de snapshot inválido.');
      }

      setResult(snapshot.result);
      setSettings(snapshot.settings);
      setActiveView('results');
      setStaleResults(false);
      setStatusMessage(`Snapshot "${file.name}" carregado com sucesso.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Falha ao ler o snapshot informado.');
    }
  };

  const parsedFileAlerts = useMemo(() => {
    if (!result) {
      return [];
    }

    return result.processedFiles.flatMap((file) => file.warnings.map((warning) => `${file.fileName}: ${warning}`));
  }, [result]);

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <span className="hero__eyebrow">Plataforma de auditoria preventiva e fiscalização contratual</span>
          <h1>CRECI/PR x SCIRE</h1>
          <p>
            Anexe em PDF, Excel ou CSV as bases do CRECI/PR, da SCIRE, os usuários oficiais e os documentos contratuais
            para que o sistema confronte as evidências, separe obrigação contratual de melhoria evolutiva e gere
            relatório técnico unificado e justificável.
          </p>
        </div>

        <div className="hero__status">
          <div className="hero__status-card">
            <span>Modo de uso</span>
            <strong>Auditoria unificada CRECI x SCIRE</strong>
            <small>Confronto documental, classificação contratual e relatório técnico consolidado</small>
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
          <div className="hero__status-card">
            <span>Histórico local</span>
            <strong>{savedAnalysisRecords.length} análise(s) salva(s)</strong>
            <small>Os dados ficam armazenados neste navegador</small>
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
        <button type="button" className="button" onClick={handlePersistAnalysis} disabled={!result}>
          Salvar análise
        </button>
        <button type="button" className="button" onClick={handleDownloadSnapshot} disabled={!result}>
          Baixar snapshot
        </button>
        <label className="button button--success toolbar-upload">
          Importar snapshot
          <input
            className="hidden-input"
            type="file"
            accept=".json"
            onChange={(event) => {
              void handleLoadSnapshotFile(event.target.files);
              event.currentTarget.value = '';
            }}
          />
        </label>
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
      </section>

      <section className="status-banner">
        <strong>{statusMessage}</strong>
        {staleResults && <span>Os resultados anteriores não devem ser considerados definitivos até novo processamento.</span>}
      </section>

      {isProcessing && ocrProgress && (
        <section className="ocr-progress-card">
          <div className="ocr-progress-card__header">
            <div>
              <strong>OCR em andamento</strong>
              <span>
                {ocrProgress.fileName} · página {ocrProgress.page} de {ocrProgress.totalPages}
              </span>
            </div>
            <strong>{Math.round(ocrProgress.overallProgress * 100)}%</strong>
          </div>
          <div className="ocr-progress-bar" aria-hidden="true">
            <div className="ocr-progress-bar__fill" style={{ width: `${Math.max(2, Math.round(ocrProgress.overallProgress * 100))}%` }} />
          </div>
          <small className="ocr-progress-card__status">
            {ocrProgress.status} ({Math.round(ocrProgress.progress * 100)}% da página atual)
          </small>
        </section>
      )}

      <div className="layout-grid">
        <div className="layout-main">
          <SavedAnalysesPanel
            analyses={savedAnalyses}
            loading={false}
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
                      isPersistent={PERSISTENT_SECTION_IDS.includes(definition.id as UploadSectionId)}
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
                  Anexe em PDF, Excel ou CSV as bases do CRECI/PR, da SCIRE, os usuários oficiais e os documentos
                  contratuais para gerar o confronto entre as bases, classificar cada demanda entre contratual e melhoria
                  e emitir o relatório técnico consolidado.
                </p>
                <ul className="side-list">
                  <li>O sistema aceita múltiplos PDFs, XLS, XLSX e CSV em todas as bases operacionais.</li>
                  <li>Documentos DOCX contratuais também são lidos no navegador.</li>
                  <li>Arquivos DOC legados ficam registrados, mas exigem conversão para leitura completa.</li>
                  <li>As análises podem ser salvas localmente no navegador e exportadas como snapshot JSON.</li>
                </ul>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}