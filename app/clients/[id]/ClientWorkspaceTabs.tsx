import { db } from '@/lib/db';
import { buildLaunchStatusItems } from '@/lib/client-launch-status';

type ClientWorkspaceTabsProps = {
  companyId: string;
  active: 'profile' | 'crm' | 'comms' | 'telnyx' | 'booking';
};

export async function ClientWorkspaceTabs({ companyId, active }: ClientWorkspaceTabsProps) {
  const [company, latestTelnyxSetupEvent, latestBookingSetupEvent, latestMessagingEvent] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        notificationEmail: true,
        website: true,
        primaryContactName: true,
        primaryContactEmail: true,
        primaryContactPhone: true,
        telnyxInboundNumber: true,
        telnyxInboundNumbers: {
          select: { number: true },
          orderBy: { createdAt: 'asc' }
        }
      }
    }),
    db.eventLog.findFirst({
      where: { companyId, eventType: 'client_telnyx_setup_updated' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true }
    }),
    db.eventLog.findFirst({
      where: { companyId, eventType: 'client_calendar_setup_updated' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true }
    }),
    db.eventLog.findFirst({
      where: {
        companyId,
        eventType: {
          in: [
            'message_received',
            'operator_messaging_test_sent',
            'operator_messaging_test_failed',
            'telnyx_message_sent',
            'telnyx_message_delivery_failed'
          ]
        }
      },
      orderBy: { createdAt: 'desc' },
      select: { eventType: true }
    })
  ]);

  const launchItems = company
    ? buildLaunchStatusItems({
        company,
        companyId,
        telnyxPayload: latestTelnyxSetupEvent?.payload,
        bookingPayload: latestBookingSetupEvent?.payload,
        latestMessagingEventType: latestMessagingEvent?.eventType || null
      })
    : [];

  return (
    <>
      <section className="panel panel-stack">
        <div className="workspace-tab-row">
          <a
            className={`workspace-tab-link ${active === 'profile' ? 'is-active' : ''}`}
            href={`/clients/${companyId}`}
          >
            Client profile
          </a>
          <a
            className={`workspace-tab-link ${active === 'crm' ? 'is-active' : ''}`}
            href={`/clients/${companyId}/crm`}
          >
            CRM
          </a>
          <a
            className={`workspace-tab-link ${active === 'comms' ? 'is-active' : ''}`}
            href={`/clients/${companyId}/operator?lab=sms`}
          >
            Comms Lab
          </a>
          <a
            className={`workspace-tab-link ${active === 'telnyx' ? 'is-active' : ''}`}
            href={`/clients/${companyId}/telnyx`}
          >
            Telnyx Setup
          </a>
          <a
            className={`workspace-tab-link ${active === 'booking' ? 'is-active' : ''}`}
            href={`/clients/${companyId}/booking`}
          >
            Booking
          </a>
        </div>
      </section>

      {launchItems.length > 0 ? (
        <section className="panel panel-stack client-launch-strip">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Client launch status</div>
              <h3 className="section-title">Onboarding, testing, and monitoring in one line</h3>
              <div className="record-subtitle">
                Move left to right: keep the profile accurate, finish setup, prove messaging, confirm booking, then launch.
              </div>
            </div>
          </div>
          <div className="client-launch-grid">
            {launchItems.map((item) => (
              <a key={item.key} className={`client-launch-card is-${item.tone}`} href={item.href}>
                <span className="metric-label">{item.label}</span>
                <strong>{item.value}</strong>
                <span className="tiny-muted">{item.detail}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
