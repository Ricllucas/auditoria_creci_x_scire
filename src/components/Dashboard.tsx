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
  const cards = [
    ['Total de chamados analisados', String(metrics.totalDemands)],
    ['Chamados da SCIRE', String(metrics.scireDemands)],
    ['Chamados do CRECI/PR', String(metrics.creciDemands)],
    ['Chamados em ambas as bases', String(metrics.bothBases)],
    ['Chamados apenas na SCIRE', String(metrics.onlyScire)],
    ['Chamados apenas no CRECI/PR', String(metrics.onlyCreci)],
    ['Obrigações contratuais', String(metrics.contractualObligations)],
    ['Melhorias evolutivas', String(metrics.evolutionaryImprovements)],
    ['Casos mistos', String(metrics.mixedCases)],
    ['Pendentes de validação', String(metrics.pendingValidation)],
    ['Duplicidades', String(metrics.duplicates)],
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

      <div className="metrics-grid">
        {cards.map(([label, value]) => (
          <article key={label} className="metric-card">
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

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
