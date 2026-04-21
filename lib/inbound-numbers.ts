import { normalizePhone } from '@/lib/phone';

export type CompanyRoutingSnapshot = {
  telnyxInboundNumber: string | null;
  telnyxInboundNumbers?: { number: string }[] | null;
};

type InboundNumberLike = string | null | undefined | FormDataEntryValue;

function coerceInboundInput(value: InboundNumberLike) {
  return String(value || '').trim();
}

export function parseInboundNumberList(value: InboundNumberLike) {
  const raw = coerceInboundInput(value);

  if (!raw) {
    return [];
  }

  return raw
    .split(/[,\n]/)
    .map((entry) => normalizePhone(entry))
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index);
}

export function hasInboundRouting(company: CompanyRoutingSnapshot | null | undefined): boolean {
  if (!company) {
    return false;
  }

  if (company.telnyxInboundNumber) {
    return true;
  }

  return Boolean(company.telnyxInboundNumbers && company.telnyxInboundNumbers.length > 0);
}

export function companyPrimaryInboundNumber(company: CompanyRoutingSnapshot | null | undefined) {
  if (!company) {
    return null;
  }

  const primaryFromScalar = normalizePhone(company.telnyxInboundNumber || '');

  if (primaryFromScalar) {
    return primaryFromScalar;
  }

  const related = company.telnyxInboundNumbers?.[0]?.number;

  return related ? normalizePhone(related) : null;
}

export function allInboundNumbers(company: CompanyRoutingSnapshot | null | undefined) {
  if (!company) {
    return [];
  }

  const numbers = new Set<string>();

  const scalar = normalizePhone(company.telnyxInboundNumber || '');
  if (scalar) {
    numbers.add(scalar);
  }

  company.telnyxInboundNumbers?.forEach((row) => {
    const normalized = normalizePhone(row.number || '');

    if (normalized) {
      numbers.add(normalized);
    }
  });

  return [...numbers];
}

export function formatInboundNumbersForInput(company: CompanyRoutingSnapshot | null | undefined) {
  if (!company) {
    return '';
  }

  const numbers = new Set<string>();

  const scalar = normalizePhone(company.telnyxInboundNumber || '');
  if (scalar) {
    numbers.add(scalar);
  }

  company.telnyxInboundNumbers?.forEach((row) => {
    const normalized = normalizePhone(row.number || '');

    if (normalized) {
      numbers.add(normalized);
    }
  });

  return [...numbers].join('\n');
}
