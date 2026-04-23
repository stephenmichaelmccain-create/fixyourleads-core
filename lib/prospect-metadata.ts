const PROSPECT_META_PREFIX = 'fyl:';

export type ProspectProfile = {
  clinicType?: string;
  zipCode?: string;
  predictedRevenue?: string;
  source?: string;
  importBatch?: string;
  sourceRecord?: string;
  logoUrl?: string;
};

export function parseProspectNotes(notes?: string | null) {
  const profile: ProspectProfile = {};
  const plainLines: string[] = [];

  for (const line of String(notes || '').split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      plainLines.push('');
      continue;
    }

    if (!trimmed.startsWith(PROSPECT_META_PREFIX)) {
      plainLines.push(line);
      continue;
    }

    const metadata = trimmed.slice(PROSPECT_META_PREFIX.length);
    const [rawKey, ...valueParts] = metadata.split('=');
    const key = rawKey?.trim();
    const value = valueParts.join('=').trim();

    if (!key || !value) {
      continue;
    }

    if (key === 'clinic_type') {
      profile.clinicType = value;
    } else if (key === 'zip_code') {
      profile.zipCode = value;
    } else if (key === 'predicted_revenue') {
      profile.predictedRevenue = value;
    } else if (key === 'source') {
      profile.source = value;
    } else if (key === 'import_batch') {
      profile.importBatch = value;
    } else if (key === 'source_record') {
      profile.sourceRecord = value;
    } else if (key === 'logo_url') {
      profile.logoUrl = value;
    }
  }

  return {
    profile,
    plainNotes: plainLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  };
}

export function buildProspectNotes({
  plainNotes,
  clinicType,
  zipCode,
  predictedRevenue,
  sourceLabel,
  importBatch,
  sourceRecord,
  logoUrl
}: {
  plainNotes?: string | null;
  clinicType?: string | null;
  zipCode?: string | null;
  predictedRevenue?: string | null;
  sourceLabel?: string | null;
  importBatch?: string | null;
  sourceRecord?: string | null;
  logoUrl?: string | null;
}) {
  const metadataEntries = [
    ['clinic_type', clinicType],
    ['zip_code', zipCode],
    ['predicted_revenue', predictedRevenue],
    ['source', sourceLabel],
    ['import_batch', importBatch],
    ['source_record', sourceRecord],
    ['logo_url', logoUrl]
  ].filter((entry): entry is [string, string] => Boolean(entry[1] && String(entry[1]).trim()));

  const metadataLines = metadataEntries.map(([key, value]) => `${PROSPECT_META_PREFIX}${key}=${String(value).trim()}`);
  const cleanNotes = String(plainNotes || '').trim();

  return [...metadataLines, cleanNotes].filter(Boolean).join('\n');
}
