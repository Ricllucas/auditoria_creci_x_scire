import { AnalysisResult } from '../types';
import { formatCurrency, formatDateTime, formatNumber } from '../utils/format';

interface ReportViewProps {
  result: AnalysisResult;
}

export function ReportView({ result }: ReportViewProps) {
  const unified = result.unifiedReport;

  if (!unified) {
    return (
      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>Relatório técnico final</h2>
            <p>Não foi possível montar o relatório técnico unificado.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2>{unified.subtitle}</h2>
          <p>
            {unified.processReference} • Emitido em {unified.issuedAtLabel} • valor/hora aplicado{' '}
            {formatCurrency(result.settings.hourlyRate)}
          </p>
        </div>
      </div>

      <article className="report-section">
        <h3>1. Apresentação</h3>
        {unified.presentationParagraphs.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </article>

      <article className="report-section">
        <h3>2. Resumo Executivo (Consolidação de Todos os Departamentos)</h3>
        <div className="report-table-wrapper">
          <table className="report-table">
            <tbody>
              <tr>
                <th>Total geral de demandas identificadas</th>
                <td>{unified.totals.totalDemands}</td>
              </tr>
              <tr>
                <th>Chamados encerrados – via suporte</th>
                <td>{unified.totals.closedSupport}</td>
              </tr>
              <tr>
                <th>Chamados abertos / em desenvolvimento – via suporte</th>
                <td>{unified.totals.openSupport}</td>
              </tr>
              <tr>
                <th>Demandas fora do suporte – sem chamado formal</th>
                <td>{unified.totals.outsideSupport}</td>
              </tr>
              <tr>
                <th>Faturamento SCIRE correlato reivindicado</th>
                <td>{unified.totals.scireClaimedCount} chamados</td>
              </tr>
              <tr>
                <th>Acervo documental comprovado em suporte pelos departamentos do CRECI</th>
                <td>{unified.totals.documentedCreciCount} chamados</td>
              </tr>
              <tr>
                <th>Divergências mapeadas / cobranças sem amparo de documento</th>
                <td>{unified.totals.mappedDivergences} chamados</td>
              </tr>
              <tr>
                <th>Desconto de glosa estimado por divergência geral</th>
                <td>{formatCurrency(unified.totals.estimatedGlosaValue)}</td>
              </tr>
              <tr>
                <th>Valor total cobrado pela SCIRE</th>
                <td>{formatCurrency(unified.totals.billedValue)}</td>
              </tr>
              <tr>
                <th>Horas técnicas totais projetadas sob a ótica do CRECI</th>
                <td>
                  {formatCurrency(unified.totals.dueValue)} ({formatNumber(result.dashboard.recognizedHours)}h totais)
                </td>
              </tr>
              <tr>
                <th>Diferença entre o valor cobrado pela SCIRE e o valor efetivamente devido pelo CRECI</th>
                <td>{formatCurrency(unified.totals.differenceBetweenClaimedAndDue)}</td>
              </tr>
              <tr>
                <th>Valor contratado para horas técnicas (Franquia base de 684h × valor/hora)</th>
                <td>{formatCurrency(unified.totals.contractualFranchiseValue)}</td>
              </tr>
              <tr>
                <th>Saldo de horas de melhorias excedentes a serem suplementadas</th>
                <td>
                  {formatCurrency(unified.totals.supplementaryValue)} ({formatNumber(unified.totals.supplementaryHours)}
                  h excedentes)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article className="report-section">
        <h3>3. Quadro comparativo das áreas de alocação do CRECI/PR (SCIRE vs CRECI)</h3>
        <div className="report-table-wrapper">
          <table className="report-table">
            <thead>
              <tr>
                <th>Departamento</th>
                <th>SCIRE (Planilha de Faturamento)</th>
                <th>CRECI (Melhorias)</th>
                <th>Divergência / Glosa</th>
              </tr>
            </thead>
            <tbody>
              {unified.departmentComparisons.map((item) => (
                <tr key={item.department}>
                  <td>{item.department}</td>
                  <td>
                    {item.scireCount} itens ({formatNumber(item.scireHours)}h | {formatCurrency(item.scireValue)})
                  </td>
                  <td>
                    {item.creciCount} itens ({formatNumber(item.creciHours)}h | {formatCurrency(item.creciValue)})
                  </td>
                  <td>{item.divergenceLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="report-section">
        <h3>4. Relação Analítica de Demandas por Departamento e Solicitante</h3>
        <div className="report-table-wrapper">
          <table className="report-table">
            <thead>
              <tr>
                <th>Departamento / Setor do CRECI</th>
                <th>Total Ocorrências</th>
                <th>Contratuais (Sem Custo)</th>
                <th>Melhorias (Consome Hb)</th>
              </tr>
            </thead>
            <tbody>
              {unified.departmentDistribution.map((item) => (
                <tr key={item.department}>
                  <td>{item.department}</td>
                  <td>{item.totalOccurrences}</td>
                  <td>
                    {item.contractualCount} ({Math.round(item.contractualPercentage)}%)
                  </td>
                  <td>
                    {item.improvementCount} ({Math.round(item.improvementPercentage)}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="report-section">
        <h3>5. Relação Analítica Consolidada</h3>
        <div className="report-table-wrapper">
          <table className="report-table report-table--dense">
            <thead>
              <tr>
                <th>ID / Chamado</th>
                <th>Título e Detalhes do Chamado</th>
                <th>Usuário Solicitante</th>
                <th>Departamento</th>
                <th>Módulo</th>
                <th>Abertura</th>
                <th>Situação</th>
                <th>Enquadramento</th>
                <th>Horas (SCIRE)</th>
                <th>Ações de Auditoria</th>
              </tr>
            </thead>
            <tbody>
              {unified.analyticRows.map((item) => (
                <tr key={item.rowId}>
                  <td>{item.displayCode}</td>
                  <td>{item.title}</td>
                  <td>{item.requester}</td>
                  <td>{item.department}</td>
                  <td>{item.module}</td>
                  <td>{item.openedAt}</td>
                  <td>{item.status}</td>
                  <td>{item.framing}</td>
                  <td>{formatNumber(item.scireHours)}h</td>
                  <td>{item.auditAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="report-section">
        <h3>6. Análise Qualitativa do Enquadramento Contratual</h3>
        <p>
          As obrigações contratuais reais compreendem correções de inconformidades lógicas, bugs, falhas operacionais,
          ajustes simples de leiaute, problemas de banco de dados, sincronizações e recomposições de funcionalidade já
          prevista no escopo contratado. Tais ocorrências não podem gerar cobrança adicional ao CRECI/PR.
        </p>
        <p>
          As melhorias sistêmicas legítimas abrangem novos fluxos, novas telas, relatórios gerenciais inéditos,
          automações, integrações adicionais e incrementos funcionais que expandem o valor do software além da
          manutenção ordinária. Esses itens somente podem consumir franquia ou banco de horas quando comprovados e
          contratualmente compatíveis.
        </p>
      </article>

      <article className="report-section">
        <h3>7. Recomendações Críticas e Priorizadoras</h3>
        <div className="report-table-wrapper">
          <table className="report-table">
            <thead>
              <tr>
                <th>Prioridade</th>
                <th>Descrição Simplificada da Ação Técnica Exigida</th>
                <th>Ref. Cláusula / Chamado</th>
                <th>Enquadramento</th>
              </tr>
            </thead>
            <tbody>
              {unified.recommendations.map((item) => (
                <tr key={`${item.priority}-${item.reference}`}>
                  <td>{item.priority}</td>
                  <td>{item.description}</td>
                  <td>{item.reference}</td>
                  <td>{item.framing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="report-section">
        <h3>8. Conclusão Administrativa e Diretriz de Conciliação</h3>
        {unified.conclusionParagraphs.map((item) => (
          <p key={item}>{item}</p>
        ))}
        <p>Relatório gerado em {formatDateTime(result.generatedAt)}.</p>
      </article>
    </section>
  );
}