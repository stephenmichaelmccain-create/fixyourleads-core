import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { createAppointmentFlow, resolveAppointmentStartTime } from '@/services/booking';

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    companyId,
    contactId,
    startTime,
    purpose,
    meetingUrl,
    displayCompanyName,
    sourceProspectId,
    notes,
    callExternalId,
    callRecordingUrl,
    callTranscriptUrl,
    callTranscriptText
  } = body;

  if (!companyId || !contactId || !startTime) {
    return NextResponse.json({ error: 'companyId_contactId_startTime_required' }, { status: 400 });
  }

  if (Number.isNaN(new Date(startTime).getTime())) {
    return NextResponse.json({ error: 'invalid_startTime' }, { status: 400 });
  }

  try {
    const result = await createAppointmentFlow({
      companyId,
      contactId,
      startTime: resolveAppointmentStartTime(new Date(startTime)),
      purpose,
      meetingUrl,
      displayCompanyName,
      sourceProspectId,
      notes,
      callExternalId,
      callRecordingUrl,
      callTranscriptUrl,
      callTranscriptText
    });

    return NextResponse.json(
      {
        ok: true,
        ...result
      },
      { status: result.bookingStatus === 'created' ? 201 : 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'booking_failed'
      },
      { status: 400 }
    );
  }
}
