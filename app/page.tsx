import { LayoutShell } from './components/LayoutShell';
import { db } from '@/lib/db';
import { hasInboundRouting } from '@/lib/inbound-numbers';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function formatPlural(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export default async function HomePage() {
  const todayStart = startOfDay();
  const tomorrowStart = addDays(todayStart, 1);
  const yesterdayStart = addDays(todayStart, -1);

  const [allCompanies, conversations, appointmentsToday, yesterdayCounts] = await Promise.all([
    safeLoad(
      () =>
        db.company.findMany({
          orderBy: { name: 'asc' },
          include: {
            telnyxInboundNumbers: {
              select: { number: true }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.conversation.findMany({
          include: {
            company: {
              select: {
                id: true,
                name: true,
                notificationEmail: true,
                telnyxInboundNumber: true,
                telnyxInboundNumbers: {
                  select: { number: true }
                }
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                direction: true,
                createdAt: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.appointment.count({
          where: {
            startTime: {
              gte: todayStart,
              lt: tomorrowStart
            }
          }
        }),
      0
    ),
    Promise.all([
      safeLoad(
        () =>
          db.lead.count({
            where: {
              createdAt: {
                gte: yesterdayStart,
                lt: todayStart
              }
            }
          }),
        0
      ),
      safeLoad(
        () =>
          db.appointment.count({
            where: {
              createdAt: {
                gte: yesterdayStart,
                lt: todayStart
              }
            }
          }),
        0
      ),
      safeLoad(
        () =>
          db.message.count({
            where: {
              createdAt: {
                gte: yesterdayStart,
                lt: todayStart
              }
            }
          }),
        0
      )
    ])
  ]);

  const companies = allCompanies.filter((company) => !isLikelyTestWorkspaceName(company.name));
  const activeCompanyIds = new Set(companies.map((company) => company.id));
  const liveConversations = conversations.filter((conversation) => activeCompanyIds.has(conversation.companyId));
  const unreadClientMessages = liveConversations.filter((conversation) => conversation.messages[0]?.direction === 'INBOUND').length;
  const clientsNeedingAttention = companies.filter((company) => {
    const hasUnreadConversation = liveConversations.some(
      (conversation) => conversation.companyId === company.id && conversation.messages[0]?.direction === 'INBOUND'
    );

    return !hasInboundRouting(company) || !company.notificationEmail || hasUnreadConversation;
  }).length;

  const [newLeadsYesterday, appointmentsYesterday, messagesYesterday] = yesterdayCounts;
  const allClear = unreadClientMessages === 0 && appointmentsToday === 0 && clientsNeedingAttention === 0;

  return (
    <LayoutShell
      title="Good morning, Levi."
      description="Five-minute morning check."
      section="home"
    >
      {!allClear ? (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot warn" />
            <strong>Something needs attention.</strong>
          </div>
          <div className="text-muted">Start with unread client messages, then today’s appointments, then any setup issues.</div>
        </section>
      ) : (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Everything is running.</strong>
          </div>
          <div className="text-muted">Nothing needs your attention right now.</div>
        </section>
      )}

      <div className="panel-grid">
        <section className="metric-card">
          <div className="metric-label">Unread client messages</div>
          <div className="metric-value">{unreadClientMessages}</div>
          <div className="metric-copy">Messages where the latest reply came from the clinic.</div>
        </section>

        <section className="metric-card">
          <div className="metric-label">Appointments today</div>
          <div className="metric-value">{appointmentsToday}</div>
          <div className="metric-copy">Booked appointments across active client workspaces.</div>
        </section>

        <section className="metric-card">
          <div className="metric-label">Clients needing attention</div>
          <div className="metric-value">{clientsNeedingAttention}</div>
          <div className="metric-copy">Missing setup or waiting on a human reply.</div>
        </section>
      </div>

      <section className="panel panel-stack">
        <div className="metric-label">Yesterday</div>
        <h2 className="section-title">Quick recap</h2>
        <p className="page-copy">
          Yesterday you captured {formatPlural(newLeadsYesterday, 'new lead')}, booked{' '}
          {formatPlural(appointmentsYesterday, 'appointment')}, and handled {formatPlural(messagesYesterday, 'message')}.
        </p>
      </section>
    </LayoutShell>
  );
}
