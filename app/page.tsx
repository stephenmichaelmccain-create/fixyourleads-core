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
      description="This is the five-minute morning check. Open the one thing that needs you and skip the rest."
      section="home"
    >
      <div className="panel-grid">
        <section className="panel panel-stack panel-dark">
          <div className="metric-label">Coffee check</div>
          <h2 className="section-title section-title-large">
            {allClear ? 'Everything is running.' : 'Here is what needs you first.'}
          </h2>
          <p className="page-copy">
            {allClear
              ? 'Nothing needs your attention right now. You can leave the CRM alone unless a new client or prospect comes in.'
              : 'Work the unread client messages first, then today’s appointments, then any client setup issues.'}
          </p>
          <div className="inline-actions">
            <a className="button" href="/messages?filter=needs_human">
              Work messages
            </a>
            <a className="button-secondary" href="/clients">
              Open clients
            </a>
            <a className="button-ghost" href="/leads">
              Open leads
            </a>
          </div>
        </section>

        <section className="metric-card">
          <div className="metric-label">Unread client messages</div>
          <div className="metric-value">{unreadClientMessages}</div>
          <div className="metric-copy">Messages where the latest reply came from the clinic and now needs a human.</div>
          <a className="button-secondary" href="/messages?filter=needs_human">
            Work now
          </a>
        </section>

        <section className="metric-card">
          <div className="metric-label">Appointments today</div>
          <div className="metric-value">{appointmentsToday}</div>
          <div className="metric-copy">Today’s booked appointments across active client workspaces.</div>
          <a className="button-secondary" href="/clients">
            View
          </a>
        </section>

        <section className="metric-card">
          <div className="metric-label">Clients needing attention</div>
          <div className="metric-value">{clientsNeedingAttention}</div>
          <div className="metric-copy">Clients missing routing or notification setup, or waiting on a human reply.</div>
          <a className="button-secondary" href="/clients">
            Fix now
          </a>
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
