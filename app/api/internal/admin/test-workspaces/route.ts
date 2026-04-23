import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiKey } from '@/lib/api-auth';
import { isLikelyTestProspectName, isLikelyTestWorkspaceName } from '@/lib/test-workspaces';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

async function loadCleanupCandidates() {
  const [companies, prospects] = await Promise.all([
    db.company.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        notificationEmail: true,
        telnyxInboundNumber: true,
        telnyxInboundNumbers: {
          select: { number: true }
        }
      }
    }),
    db.prospect.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        companyId: true,
        status: true
      }
    })
  ]);

  const companyCandidates = companies
    .filter((company) => isLikelyTestWorkspaceName(company.name))
    .map((company) => ({
      id: company.id,
      name: company.name,
      notificationEmail: company.notificationEmail || null,
      inboundNumbers: company.telnyxInboundNumbers.map((row) => row.number)
    }));

  const prospectCandidates = prospects
    .filter((prospect) => isLikelyTestProspectName(prospect.name))
    .map((prospect) => ({
      id: prospect.id,
      name: prospect.name,
      companyId: prospect.companyId,
      status: prospect.status
    }));

  return {
    companyCandidates,
    prospectCandidates
  };
}

export async function GET(request: NextRequest) {
  if (!requireApiKey(request)) {
    return unauthorized();
  }

  const candidates = await loadCleanupCandidates();

  return NextResponse.json({
    ok: true,
    dryRun: true,
    ...candidates
  });
}

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return unauthorized();
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const candidates = await loadCleanupCandidates();

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      ...candidates
    });
  }

  const companyIds = candidates.companyCandidates.map((company) => company.id);
  const prospectIds = candidates.prospectCandidates.map((prospect) => prospect.id);

  let deletedCallLogs = 0;
  let deletedProspects = 0;
  let deletedCompanies = 0;

  await db.$transaction(async (tx) => {
    if (prospectIds.length > 0) {
      const callLogResult = await tx.callLog.deleteMany({
        where: {
          prospectId: { in: prospectIds }
        }
      });

      const prospectResult = await tx.prospect.deleteMany({
        where: {
          id: { in: prospectIds }
        }
      });

      deletedCallLogs = callLogResult.count;
      deletedProspects = prospectResult.count;
    }

    if (companyIds.length > 0) {
      const companyResult = await tx.company.deleteMany({
        where: {
          id: { in: companyIds }
        }
      });

      deletedCompanies = companyResult.count;
    }
  });

  revalidatePath('/');
  revalidatePath('/clients');
  revalidatePath('/clients/intake');
  revalidatePath('/our-leads');
  revalidatePath('/events');
  revalidatePath('/diagnostics');

  return NextResponse.json({
    ok: true,
    deleted: {
      companies: deletedCompanies,
      prospects: deletedProspects,
      callLogs: deletedCallLogs
    },
    removedCompanyNames: candidates.companyCandidates.map((company) => company.name),
    removedProspectNames: candidates.prospectCandidates.map((prospect) => prospect.name)
  });
}
