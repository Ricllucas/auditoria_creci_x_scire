import { AnalysisSettings, UploadSectionDefinition, UploadSectionState } from '../types';

interface SettingsPanelProps {
  settings: AnalysisSettings;
  onChange: (settings: AnalysisSettings) => void;
  sections: UploadSectionState[];
  definitions: UploadSectionDefinition[];
}

export function SettingsPanel({ settings, onChange, sections, definitions }: SettingsPanelProps) {
  const updateField = <K extends keyof AnalysisSettings>(key: K, value: AnalysisSettings[K]) => {
    onChange({
      ...settings,
      [key]: value,
    });
  };

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2>Configuração da análise</h2>
          <p>Defina período, valor/hora, critério documental e parâmetros de cruzamento.</p>
        </div>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Nome da análise</span>
          <input
            value={settings.analysisLabel}
            onChange={(event) => updateField('analysisLabel', event.target.value)}
            placeholder="Ex.: Auditoria junho/2026"
          />
        </label>

        <label className="field">
          <span>Período inicial</span>
          <input
            type="date"
            value={settings.periodStart}
            onChange={(event) => updateField('periodStart', event.target.value)}
          />
        </label>

        <label className="field">
          <span>Período final</span>
          <input
            type="date"
            value={settings.periodEnd}
            onChange={(event) => updateField('periodEnd', event.target.value)}
          />
        </label>

        <label className="field">
          <span>Valor/hora de referência (R$)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={settings.hourlyRate}
            onChange={(event) => updateField('hourlyRate', Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Similaridade mínima para confronto textual</span>
          <input
            type="number"
            min="0.1"
            max="1"
            step="0.01"
            value={settings.similarityThreshold}
            onChange={(event) => updateField('similarityThreshold', Number(event.target.value))}
          />
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={settings.useContractHourlyRate}
            onChange={(event) => updateField('useContractHourlyRate', event.target.checked)}
          />
          <span>Priorizar valor/hora encontrado nos documentos contratuais</span>
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={settings.conservativeMode}
            onChange={(event) => updateField('conservativeMode', event.target.checked)}
          />
          <span>Aplicar diretriz conservadora para pendências e dúvidas documentais</span>
        </label>
      </div>

      <div className="risk-list">
        {definitions.map((definition) => {
          const section = sections.find((item) => item.id === definition.id);
          const isEmpty = !section?.files.length;
          return (
            <div key={definition.id} className={`risk-item ${isEmpty ? 'risk-item--alert' : 'risk-item--ok'}`}>
              <strong>{definition.title}</strong>
              <span>{isEmpty ? definition.riskMessage : 'Seção apta para uso na análise atual.'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
