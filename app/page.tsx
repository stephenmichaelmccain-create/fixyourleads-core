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

type HomeAction = {
  label: string;
  href: string;
};

function buildPrimaryAction(input: {
  clients: number;
  unreadClientMessages: number;
  clientsNeedingAttention: number;
  appointmentsToday: number;
  newLeadsYesterday: number;
}): HomeAction {
  if (input.clients === 0) {
    return {
      label: 'Add a Client',
      href: '/clients/intake'
    };
  }

  if (input.unreadClientMessages > 0) {
    return {
      label: 'Open Messages',
      href: '/messages'
    };
  }

  if (input.clientsNeedingAttention > 0) {
    return {
      label: 'Open Clients',
      href: '/clients'
    };
  }

  if (input.appointmentsToday > 0) {
    return {
      label: 'Open Clients',
      href: '/clients'
    };
  }

  if (input.newLeadsYesterday > 0) {
    return {
      label: 'Open Leads',
      href: '/leads'
    };
  }

  return {
    label: 'Check System Status',
    href: '/admin/system'
  };
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
  const primaryAction = buildPrimaryAction({
    clients: companies.length,
    unreadClientMessages,
    clientsNeedingAttention,
    appointmentsToday,
    newLeadsYesterday
  });

  return (
    <LayoutShell
      title="Home"
      section="home"
    >
      <section className="home-inline-bar">
        <div className="home-inline-status">
          <span className={`status-dot ${allClear ? 'ok' : 'warn'}`} />
          <strong>{allClear ? 'Everything is running.' : 'Something needs attention.'}</strong>
        </div>

        <div className="home-inline-metrics">
          <span className="home-inline-pill">
            <span className="metric-label">Unread client messages</span>
            <strong>{unreadClientMessages}</strong>
          </span>
          <span className="home-inline-pill">
            <span className="metric-label">Appointments today</span>
            <strong>{appointmentsToday}</strong>
          </span>
          <span className="home-inline-pill">
            <span className="metric-label">Clients needing attention</span>
            <strong>{clientsNeedingAttention}</strong>
          </span>
        </div>

        <div className="inline-actions">
          <a className="button" href={primaryAction.href}>
            {primaryAction.label}
          </a>
          <span className="tiny-muted">
            Yesterday {newLeadsYesterday} leads · {appointmentsYesterday} appointments · {messagesYesterday} messages
          </span>
        </div>
      </section>
    </LayoutShell>
  );
}
