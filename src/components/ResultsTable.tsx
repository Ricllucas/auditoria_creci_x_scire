import { useMemo, useState } from 'react';
import { AnalysisRow } from '../types';
import { formatCurrency, formatNumber, truncate } from '../utils/format';

interface ResultsTableProps {
  rows: AnalysisRow[];
}

export function ResultsTable({ rows }: ResultsTableProps) {
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('Todos');
  const [origin, setOrigin] = useState('Todos');
  const [confidence, setConfidence] = useState('Todos');

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const haystack = [
        row.callCode,
        row.title,
        row.summaryDescription,
        row.identifiedUser,
        row.officialDepartment,
        row.moduleName,
        row.auditSummary,
        row.recommendation,
      ]
        .join(' ')
        .toLowerCase();

      const matchesSearch = !search || haystack.includes(search.toLowerCase());
      const matchesClassification =
        classification === 'Todos' || row.contractualClassification === classification;
      const matchesOrigin = origin === 'Todos' || row.demandOrigin === origin;
      const matchesConfidence = confidence === 'Todos' || row.confidenceLevel === confidence;

      return matchesSearch && matchesClassification && matchesOrigin && matchesConfidence;
    });
  }, [classification, confidence, origin, rows, search]);

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2>Tabela analítica final</h2>
          <p>Filtre por classificação, origem, confiança, módulo e resumo das regras de auditoria aplicadas.</p>
        </div>
      </div>

      <div className="filters-grid">
        <input
          placeholder="Buscar por código, título, usuário, módulo ou regra"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={classification} onChange={(event) => setClassification(event.target.value)}>
          {['Todos', ...new Set(rows.map((row) => row.contractualClassification))].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={origin} onChange={(event) => setOrigin(event.target.value)}>
          {['Todos', ...new Set(rows.map((row) => row.demandOrigin))].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={confidence} onChange={(event) => setConfidence(event.target.value)}>
          {['Todos', ...new Set(rows.map((row) => row.confidenceLevel))].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Título</th>
              <th>Módulo</th>
              <th>Origem</th>
              <th>Departamento oficial</th>
              <th>Comparação</th>
              <th>Classificação</th>
              <th>Regras</th>
              <th>Tempo (h)</th>
              <th>Cobrado</th>
              <th>Devido</th>
              <th>Glosável</th>
              <th>Confiança</th>
              <th>Recomendação</th>
              <th>Inconsistências</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>{row.callCode}</td>
                <td title={row.summaryDescription}>{truncate(row.title, 64)}</td>
                <td>{row.moduleName}</td>
                <td>{row.demandOrigin}</td>
                <td>{row.officialDepartment}</td>
                <td>{row.comparison}</td>
                <td>{row.contractualClassification}</td>
                <td title={row.auditSummary}>{truncate(row.auditSummary, 70)}</td>
                <td>{formatNumber(row.timeHours)}</td>
                <td>{formatCurrency(row.billedValue)}</td>
                <td>{formatCurrency(row.technicalDueValue)}</td>
                <td>{formatCurrency(row.glosableValue)}</td>
                <td>{row.confidenceLevel}</td>
                <td>{row.recommendation}</td>
                <td title={row.inconsistencies}>{truncate(row.inconsistencies, 90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}