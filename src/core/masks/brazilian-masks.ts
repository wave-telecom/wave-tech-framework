export function numberMask(value: string): string {
  return value.replace(/\D/g, "");
}

export function cpfTaxIdMask(value: string): string {
  return value
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function cnpjTaxIdMask(value: string): string {
  return value
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function taxIdMask(value: string): string {
  const valueWithoutSpecialCharacters = numberMask(value);
  return valueWithoutSpecialCharacters.length > 11
    ? cnpjTaxIdMask(valueWithoutSpecialCharacters)
    : cpfTaxIdMask(valueWithoutSpecialCharacters);
}
