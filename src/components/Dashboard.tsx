import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DashboardMetrics } from '../types';
import { formatCurrency, formatNumber } from '../utils/format';

interface DashboardProps {
  metrics: DashboardMetrics;
}

const COLORS = ['#1f4b99', '#3b7f4f', '#b8791c', '#8b3d3d', '#6c57b3', '#16738b'];

export function Dashboard({ metrics }: DashboardProps) {
  const pipeline = metrics.pipelineSummary;

  const classificationCards = [
    ['Obrigações contratuais', String(metrics.contractualObligations)],
    ['Melhorias evolutivas', String(metrics.evolutionaryImprovements)],
    ['Casos mistos', String(metrics.mixedCases)],
    ['Pendentes de validação', String(metrics.pendingValidation)],
    ['Duplicidades', String(metrics.duplicates)],
  ];

  const valueCards = [
    ['Valor cobrado pela SCIRE', formatCurrency(metrics.billedValue)],
    ['Valor tecnicamente devido', formatCurrency(metrics.technicalDueValue)],
    ['Valor glosável', formatCurrency(metrics.glosableValue)],
    ['Economia estimada', formatCurrency(metrics.estimatedSavings)],
    ['Percentual de glosa', `${formatNumber(metrics.glosaPercentage)}%`],
  ];

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2>Painel gerencial</h2>
          <p>Indicadores executivos, distribuição por classificação e volumetria por área.</p>
        </div>
      </div>

      {/* ── Bloco 1: Contagens brutas dos arquivos ── */}
      <div className="dashboard-block">
        <h3 className="dashboard-block__title">Chamados nos arquivos importados</h3>
        <p className="dashboard-block__subtitle">Contagem real das linhas reconhecidas em cada base de dados.</p>
        <div className="metrics-grid metrics-grid--highlight">
          {pipeline ? (
            <>
              <article className="metric-card metric-card--primary">
                <span>Total de chamados SCIRE</span>
                <strong>{pipeline.normalizedScireTickets}</strong>
              </article>
              <article className="metric-card metric-card--primary">
                <span>Total de chamados CRECI/PR</span>
                <strong>{pipeline.normalizedCreciTickets}</strong>
              </article>
              <article className="metric-card metric-card--primary">
                <span>Usuários cadastrados</span>
                <strong>{pipeline.normalizedUsers}</strong>
              </article>
            </>
          ) : (
            <article className="metric-card">
              <span>Dados de pipeline não disponíveis</span>
              <strong>—</strong>
            </article>
          )}
        </div>
      </div>

      {/* ── Bloco 2: Resultado do confronto CRECI × SCIRE ── */}
      <div className="dashboard-block">
        <h3 className="dashboard-block__title">Confronto CRECI × SCIRE</h3>
        <p className="dashboard-block__subtitle">
          Após o cruzamento dos chamados, cada par (ou chamado isolado) forma um "grupo auditado".
          Um grupo com match em ambas as bases aparece uma única vez.
        </p>
        <div className="metrics-grid">
          <article className="metric-card">
            <span>Total de grupos auditados</span>
            <strong>{metrics.totalDemands}</strong>
          </article>
          <article className="metric-card">
            <span>Com correspondência em ambas</span>
            <strong>{metrics.bothBases}</strong>
          </article>
          <article className="metric-card">
            <span>Apenas na SCIRE (sem match CRECI)</span>
            <strong>{metrics.onlyScire}</strong>
          </article>
          <article className="metric-card">
            <span>Apenas no CRECI (sem match SCIRE)</span>
            <strong>{metrics.onlyCreci}</strong>
          </article>
        </div>
      </div>

      {/* ── Bloco 3: Classificação contratual ── */}
      <div className="dashboard-block">
        <h3 className="dashboard-block__title">Classificação dos grupos</h3>
        <div className="metrics-grid">
          {classificationCards.map(([label, value]) => (
            <article key={label} className="metric-card">
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      </div>

      {/* ── Bloco 4: Valores financeiros ── */}
      <div className="dashboard-block">
        <h3 className="dashboard-block__title">Análise financeira</h3>
        <div className="metrics-grid">
          {valueCards.map(([label, value]) => (
            <article key={label} className="metric-card">
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      </div>

      {/* ── Gráficos ── */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Classificação contratual</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={metrics.byClassification}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-15} textAnchor="end" height={70} interval={0} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="total" fill="#1f4b99" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Nível de confiança</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={metrics.byConfidence} dataKey="total" nameKey="name" outerRadius={100} label>
                {metrics.byConfidence.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Total por departamento</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={metrics.byDepartment}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-18} textAnchor="end" height={84} interval={0} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="total" fill="#3b7f4f" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Total por situação</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={metrics.byStatus}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-18} textAnchor="end" height={84} interval={0} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="total" fill="#b8791c" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
