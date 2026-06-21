import { SavedAnalysisSummary } from '../types';
import { formatCurrency, formatDate, formatDateTime } from '../utils/format';

interface SavedAnalysesPanelProps {
  analyses: SavedAnalysisSummary[];
  loading: boolean;
  onRefresh: () => Promise<void> | void;
  onOpen: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}

export function SavedAnalysesPanel(props: SavedAnalysesPanelProps) {
  const { analyses, loading, onRefresh, onOpen, onDelete } = props;

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2>Histórico salvo no navegador</h2>
          <p>Consulte, reabra ou exclua análises armazenadas localmente neste computador e navegador.</p>
        </div>
        <button type="button" className="button" onClick={() => void onRefresh()} disabled={loading}>
          Atualizar lista
        </button>
      </div>

      {!analyses.length ? (
        <div className="empty-state">
          <p>Nenhuma análise foi salva ainda neste navegador.</p>
        </div>
      ) : (
        <div className="saved-analysis-list">
          {analyses.map((analysis) => (
            <article key={analysis.id} className="saved-analysis-card">
              <div className="saved-analysis-card__content">
                <strong>{analysis.name}</strong>
                <span>
                  Período: {formatDate(analysis.periodStart)} a {formatDate(analysis.periodEnd)}
                </span>
                <span>Gerada em {formatDateTime(analysis.generatedAt)}</span>
                <span>
                  {analysis.totalDemands} demanda(s) · cobrado {formatCurrency(analysis.billedValue)} · glosável{' '}
                  {formatCurrency(analysis.glosableValue)}
                </span>
              </div>
              <div className="saved-analysis-card__actions">
                <button type="button" className="button button--primary" onClick={() => void onOpen(analysis.id)}>
                  Abrir
                </button>
                <button type="button" className="button button--danger" onClick={() => void onDelete(analysis.id)}>
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}