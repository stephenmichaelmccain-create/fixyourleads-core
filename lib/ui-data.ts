import { db } from '@/lib/db';
import { envPresence } from '@/lib/runtime-safe';
import { hasInboundRouting } from '@/lib/inbound-numbers';

export async function safeLoad<T>(loader: () => Promise<T>, fallback: T) {
  try {
    return await loader();
  } catch (error) {
    console.error('safeLoad failed:', error);
    return fallback;
  }
}

export async function safeLoadDb<T>(loader: () => Promise<T>, fallback: T) {
  if (!envPresence().databaseUrlSet) {
    return fallback;
  }

  return safeLoad(loader, fallback);
}

export async function safeCountSummary() {
  if (!envPresence().databaseUrlSet) {
    return {
      companies: null,
      leads: null,
      conversations: null,
      appointments: null,
      events: null,
      ok: false as const
    };
  }

  try {
    const [companies, leads, conversations, appointments, events] = await Promise.all([
      db.company.count(),
      db.lead.count(),
      db.conversation.count(),
      db.appointment.count(),
      db.eventLog.count()
    ]);

    return { companies, leads, conversations, appointments, events, ok: true as const };
  } catch (error) {
    console.error('safeCountSummary failed:', error);
    return {
      companies: null,
      leads: null,
      conversations: null,
      appointments: null,
      events: null,
      ok: false as const
    };
  }
}

export async function safeWorkspaceOverview() {
  if (!envPresence().databaseUrlSet) {
    return {
      workspaces: [],
      ok: false as const
    };
  }

  try {
    const companies = await db.company.findMany({
      select: {
        id: true,
        name: true,
        notificationEmail: true,
        telnyxInboundNumber: true,
        telnyxInboundNumbers: {
          select: { number: true }
        },
        _count: {
          select: {
            leads: true,
            conversations: true,
            appointments: true
          }
        }
      },
      take: 8
    });

    const workspaces = companies
      .map((company) => {
        const missingRouting = Number(!hasInboundRouting(company));
        const activityScore = company._count.conversations * 3 + company._count.leads * 2 + company._count.appointments;

        return {
          id: company.id,
          name: company.name,
          notificationEmail: company.notificationEmail,
          telnyxInboundNumber: company.telnyxInboundNumber,
          telnyxInboundCount: company.telnyxInboundNumbers.length,
          leads: company._count.leads,
          conversations: company._count.conversations,
          appointments: company._count.appointments,
          missingSetupCount: missingRouting + Number(!company.notificationEmail),
          activityScore
        };
      })
      .sort((left, right) => {
        if (left.missingSetupCount !== right.missingSetupCount) {
          return left.missingSetupCount - right.missingSetupCount;
        }

        if (left.activityScore !== right.activityScore) {
          return right.activityScore - left.activityScore;
        }

        return left.name.localeCompare(right.name);
      });

    return {
      workspaces,
      ok: true as const
    };
  } catch (error) {
    console.error('safeWorkspaceOverview failed:', error);
    return {
      workspaces: [],
      ok: false as const
    };
  }
}
