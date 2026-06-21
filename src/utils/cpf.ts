export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatCpf(value: string): string {
  const digits = normalizeCpf(value);
  if (digits.length !== 11) {
    return value || 'Não informado';
  }

  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  const digits = cpf.split('').map(Number);

  const calculateCheckDigit = (baseLength: number): number => {
    const total = digits
      .slice(0, baseLength)
      .reduce((sum, digit, index) => sum + digit * (baseLength + 1 - index), 0);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateCheckDigit(9) === digits[9] && calculateCheckDigit(10) === digits[10];
}
