import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LeadStatus } from '@prisma/client';
import { requireApiKey } from '@/lib/api-auth';
import { db } from '@/lib/db';

const updateLeadStatusSchema = z.object({
  companyId: z.string().min(1),
  leadId: z.string().min(1),
  status: z.nativeEnum(LeadStatus)
});

export async function POST(request: NextRequest) {
  try {
    if (!requireApiKey(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateLeadStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
    }

    const { companyId, leadId, status } = parsed.data;
    const existingLead = await db.lead.findFirst({
      where: {
        id: leadId,
        companyId
      },
      select: { id: true }
    });

    if (!existingLead) {
      return NextResponse.json({ error: 'lead_not_found_for_company' }, { status: 404 });
    }

    const lead = await db.lead.update({
      where: { id: existingLead.id },
      data: { status }
    });
    return NextResponse.json({ ok: true, lead });
  } catch (err) {
    console.error('status update failed', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
