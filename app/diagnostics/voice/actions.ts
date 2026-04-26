"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';

function diagnosticsVoicePath(values: { notice?: string; detail?: string } = {}) {
  const params = new URLSearchParams();

  if (values.notice) {
    params.set('notice', values.notice);
  }

  if (values.detail) {
    params.set('detail', values.detail);
  }

  const search = params.toString();
  return search ? `/diagnostics/voice?${search}` : '/diagnostics/voice';
}

function revalidateVoiceSurfaces(companyId?: string | null) {
  revalidatePath('/diagnostics/voice');
  revalidatePath('/diagnostics/queues');
  revalidatePath('/admin/system');

  if (companyId) {
    revalidatePath(`/clients/${companyId}`);
    revalidatePath(`/clients/${companyId}/workflow`);
    revalidatePath(`/clients/${companyId}/operator`);
    revalidatePath(`/events?companyId=${companyId}`);
  }
}

export async function markUnroutedTelnyxEventHandledAction(formData: FormData) {
  const eventId = String(formData.get('eventId') || '').trim();

  if (!eventId) {
    redirect(diagnosticsVoicePath({ notice: 'unrouted_handle_failed', detail: 'event_required' }));
  }

  const event = await db.unroutedTelnyxEvent.findUnique({
    where: { id: eventId },
    select: { id: true, handledAt: true }
  });

  if (!event) {
    redirect(diagnosticsVoicePath({ notice: 'unrouted_handle_failed', detail: 'event_not_found' }));
  }

  if (!event.handledAt) {
    await db.unroutedTelnyxEvent.update({
      where: { id: eventId },
      data: { handledAt: new Date() }
    });
  }

  revalidateVoiceSurfaces();
  redirect(diagnosticsVoicePath({ notice: 'unrouted_handled' }));
}

export async function assignUnroutedTelnyxNumberAction(formData: FormData) {
  const eventId = String(formData.get('eventId') || '').trim();
  const companyId = String(formData.get('companyId') || '').trim();

  if (!eventId || !companyId) {
    redirect(diagnosticsVoicePath({ notice: 'unrouted_assign_failed', detail: 'event_or_company_required' }));
  }

  const [event, company] = await Promise.all([
    db.unroutedTelnyxEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        inboundNumber: true,
        fromNumber: true
      }
    }),
    db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        telnyxInboundNumber: true,
        telnyxInboundNumbers: {
          select: { number: true }
        }
      }
    })
  ]);

  if (!event || !company) {
    redirect(diagnosticsVoicePath({ notice: 'unrouted_assign_failed', detail: 'event_or_company_not_found' }));
  }

  const normalizedNumber = normalizePhone(event.inboundNumber || '');

  if (!normalizedNumber) {
    redirect(diagnosticsVoicePath({ notice: 'unrouted_assign_failed', detail: 'missing_inbound_number' }));
  }

  const conflictingCompany = await db.company.findFirst({
    where: {
      NOT: { id: company.id },
      OR: [
        { telnyxInboundNumber: normalizedNumber },
        {
          telnyxInboundNumbers: {
            some: {
              number: normalizedNumber
            }
          }
        }
      ]
    },
    select: {
      id: true,
      name: true
    }
  });

  if (conflictingCompany) {
    redirect(
      diagnosticsVoicePath({
        notice: 'unrouted_assign_failed',
        detail: `number_already_routed_to_${conflictingCompany.name}`
      })
    );
  }

  const companyAlreadyHasNumber =
    company.telnyxInboundNumber === normalizedNumber ||
    company.telnyxInboundNumbers.some((entry) => normalizePhone(entry.number) === normalizedNumber);

  await db.$transaction(async (tx) => {
    if (!companyAlreadyHasNumber) {
      await tx.company.update({
        where: { id: company.id },
        data: {
          ...(company.telnyxInboundNumber
            ? {}
            : {
                telnyxInboundNumber: normalizedNumber
              }),
          telnyxInboundNumbers: {
            create: {
              number: normalizedNumber
            }
          }
        }
      });
    }

    await tx.unroutedTelnyxEvent.update({
      where: { id: event.id },
      data: { handledAt: new Date() }
    });

    await tx.eventLog.create({
      data: {
        companyId: company.id,
        eventType: 'unrouted_telnyx_event_assigned',
        payload: {
          unroutedEventId: event.id,
          inboundNumber: normalizedNumber,
          fromNumber: event.fromNumber || null,
          companyName: company.name
        }
      }
    });
  });

  revalidateVoiceSurfaces(company.id);
  redirect(diagnosticsVoicePath({ notice: 'unrouted_assigned', detail: company.name }));
}
