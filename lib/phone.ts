function stripExtension(raw: string) {
  return raw.replace(/\s*(?:ext\.?|extension|x)\s*\d+.*$/i, '');
}

export function normalizePhone(phone: string) {
  const trimmed = stripExtension(String(phone || '').trim());

  if (!trimmed) {
    return '';
  }

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!digits || digits.length < 10 || digits.length > 15) {
    return '';
  }

  if (hasPlus) {
    return `+${digits}`;
  }

  if (digits.startsWith('00') && digits.length > 10) {
    return `+${digits.slice(2)}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}
