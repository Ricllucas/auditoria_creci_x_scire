import { AnalysisResult } from '../types';
import { formatCurrency, formatDateTime } from '../utils/format';

interface ReportViewProps {
  result: AnalysisResult;
}

export function ReportView({ result }: ReportViewProps) {
  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2>Relatório técnico final</h2>
          <p>
            Gerado em {formatDateTime(result.generatedAt)} · valor/hora aplicado {formatCurrency(result.settings.hourlyRate)}
          </p>
        </div>
      </div>

      <div className="executive-list">
        {result.executiveSummary.map((item) => (
          <article key={item} className="summary-card">
            {item}
          </article>
        ))}
      </div>

      <div className="report-sections">
        {result.reportSections.map((section) => (
          <article key={section.title} className="report-section">
            <h3>{section.title}</h3>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
