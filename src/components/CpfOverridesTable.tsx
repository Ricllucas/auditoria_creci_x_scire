import { CpfOverrideRule } from '../types';

interface CpfOverridesTableProps {
  rules: CpfOverrideRule[];
  onChange: (rules: CpfOverrideRule[]) => void;
}

export function CpfOverridesTable({ rules, onChange }: CpfOverridesTableProps) {
  const updateRule = (id: string, field: keyof Omit<CpfOverrideRule, 'id'>, value: string) => {
    onChange(
      rules.map((rule) =>
        rule.id === id
          ? {
              ...rule,
              [field]: value,
            }
          : rule,
      ),
    );
  };

  const addRule = () => {
    onChange([
      ...rules,
      {
        id: crypto.randomUUID(),
        cpf: '',
        userName: '',
        officialDepartment: '',
      },
    ]);
  };

  const removeRule = (id: string) => {
    onChange(rules.filter((rule) => rule.id !== id));
  };

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2>Redefinições Administrativas de CPF</h2>
          <p>Essas regras prevalecem sobre duplicidades encontradas na base oficial de usuários.</p>
        </div>
        <button type="button" className="button button--primary" onClick={addRule}>
          Adicionar regra
        </button>
      </div>

      <div className="table-wrapper">
        <table className="data-table data-table--compact">
          <thead>
            <tr>
              <th>CPF</th>
              <th>Usuário</th>
              <th>Departamento oficial</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>
                  <input value={rule.cpf} onChange={(event) => updateRule(rule.id, 'cpf', event.target.value)} />
                </td>
                <td>
                  <input
                    value={rule.userName}
                    onChange={(event) => updateRule(rule.id, 'userName', event.target.value)}
                  />
                </td>
                <td>
                  <input
                    value={rule.officialDepartment}
                    onChange={(event) => updateRule(rule.id, 'officialDepartment', event.target.value)}
                  />
                </td>
                <td>
                  <button type="button" className="button button--danger" onClick={() => removeRule(rule.id)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
