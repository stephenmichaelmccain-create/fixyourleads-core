import { db } from '@/lib/db';

export async function safeLoad<T>(loader: () => Promise<T>, fallback: T) {
  try {
    return await loader();
  } catch (error) {
    console.error('safeLoad failed:', error);
    return fallback;
  }
}

export async function safeCountSummary() {
  try {
    const [companies, leads, conversations, events] = await Promise.all([
      db.company.count(),
      db.lead.count(),
      db.conversation.count(),
      db.eventLog.count()
    ]);

    return { companies, leads, conversations, events, ok: true as const };
  } catch (error) {
    console.error('safeCountSummary failed:', error);
    return {
      companies: null,
      leads: null,
      conversations: null,
      events: null,
      ok: false as const
    };
  }
}
