import { Prisma, ProspectDedupKeyType, ProspectStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { normalizeClinicKey, normalizeWebsiteKey } from '@/lib/client-intake';
import { normalizePhone } from '@/lib/phone';

const companySelect = {
  id: true,
  name: true,
  notificationEmail: true
} satisfies Prisma.CompanySelect;

const prospectSelect = {
  id: true,
  name: true,
  phone: true,
  website: true,
  notes: true
} satisfies Prisma.ProspectSelect;

export type IntakeCompanyMatch = Prisma.CompanyGetPayload<{ select: typeof companySelect }>;
export type IntakeProspectMatch = Prisma.ProspectGetPayload<{ select: typeof prospectSelect }>;

type FindMatchingCompanyInput = {
  clinicName: string;
  notificationEmail?: string;
  website?: string;
};

type FindMatchingProspectInput = {
  clinicName: string;
  phone?: string;
  website?: string;
};

async function findCompanyByClinicKey(clinicKey: string) {
  if (!clinicKey) {
    return null;
  }

  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Company"
    WHERE regexp_replace(lower("name"), '[^a-z0-9]+', '', 'g') = ${clinicKey}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);

  if (!rows[0]?.id) {
    return null;
  }

  return db.company.findUnique({
    where: { id: rows[0].id },
    select: companySelect
  });
}

async function findCompanyByWebsiteKey(websiteKey: string) {
  if (!websiteKey) {
    return null;
  }

  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Company"
    WHERE split_part(
      regexp_replace(
        regexp_replace(lower(coalesce("website", '')), '^https?://', ''),
        '^www\\.',
        ''
      ),
      '/',
      1
    ) = ${websiteKey}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);

  if (!rows[0]?.id) {
    return null;
  }

  return db.company.findUnique({
    where: { id: rows[0].id },
    select: companySelect
  });
}

async function findClosedProspectByDedupKey(keyType: ProspectDedupKeyType, keyValue: string) {
  if (!keyValue) {
    return null;
  }

  const entry = await db.prospectDedupEntry.findFirst({
    where: {
      keyType,
      keyValue,
      prospect: {
        status: ProspectStatus.CLOSED
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    select: {
      prospectId: true
    }
  });

  if (!entry?.prospectId) {
    return null;
  }

  return db.prospect.findUnique({
    where: { id: entry.prospectId },
    select: prospectSelect
  });
}

export async function findMatchingCompany({
  clinicName,
  notificationEmail,
  website
}: FindMatchingCompanyInput): Promise<IntakeCompanyMatch | null> {
  const clinicKey = normalizeClinicKey(clinicName);
  const email = String(notificationEmail || '').trim().toLowerCase();
  const websiteKey = normalizeWebsiteKey(website);

  return (
    (clinicKey ? await findCompanyByClinicKey(clinicKey) : null) ||
    (email
      ? await db.company.findFirst({
          where: {
            notificationEmail: {
              equals: email,
              mode: 'insensitive'
            }
          },
          orderBy: { createdAt: 'desc' },
          select: companySelect
        })
      : null) ||
    (websiteKey ? await findCompanyByWebsiteKey(websiteKey) : null) ||
    null
  );
}

export async function findMatchingClosedProspect({
  clinicName,
  phone,
  website
}: FindMatchingProspectInput): Promise<IntakeProspectMatch | null> {
  const clinicKey = normalizeClinicKey(clinicName);
  const phoneKey = normalizePhone(phone || '');
  const websiteKey = normalizeWebsiteKey(website);

  return (
    (clinicKey ? await findClosedProspectByDedupKey(ProspectDedupKeyType.CLINIC, clinicKey) : null) ||
    (phoneKey ? await findClosedProspectByDedupKey(ProspectDedupKeyType.PHONE, phoneKey) : null) ||
    (websiteKey ? await findClosedProspectByDedupKey(ProspectDedupKeyType.WEBSITE, websiteKey) : null) ||
    null
  );
}
