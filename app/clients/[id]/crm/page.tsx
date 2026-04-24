import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

function formatCompactDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

export default async function ClientCrmPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [contacts, leads, conversations, appointments] = await Promise.all([
    safeLoad(
      () =>
        db.contact.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            createdAt: true,
            _count: {
              select: {
                leads: true,
                conversations: true,
                appointments: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.lead.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            status: true,
            source: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.conversation.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                content: true,
                createdAt: true,
                direction: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.appointment.findMany({
          where: { companyId: id },
          orderBy: { startTime: 'desc' },
          take: 25,
          select: {
            id: true,
            startTime: true,
            status: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true
              }
            }
          }
        }),
      []
    )
  ]);

  return (
    <LayoutShell
      title={`${company.name} · CRM`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="crm" />

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">CRM workspace</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              This is the collected-records view for this client: contacts, leads, conversations, and bookings already in Fix Your Leads.
            </div>
          </div>
          <div className="workspace-action-rail">
            <a className="button" href={`/clients/${company.id}/operator`}>
              Open operator workspace
            </a>
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              View events
            </a>
          </div>
        </div>

        <div className="client-record-stats">
          <div className="client-record-stat">
            <span className="metric-label">Contacts</span>
            <strong className="workspace-stats-value">{contacts.length}</strong>
            <span className="tiny-muted">Most recent people collected for this client</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Leads</span>
            <strong className="workspace-stats-value">{leads.length}</strong>
            <span className="tiny-muted">Latest lead records in this workspace</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Conversations</span>
            <strong className="workspace-stats-value">{conversations.length}</strong>
            <span className="tiny-muted">Recent messaging threads</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Bookings</span>
            <strong className="workspace-stats-value">{appointments.length}</strong>
            <span className="tiny-muted">Recent appointment records</span>
          </div>
        </div>
      </section>

      <div className="panel-stack">
        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Contacts</div>
              <h3 className="section-title">People we have collected</h3>
            </div>
          </div>
          {contacts.length === 0 ? (
            <div className="empty-state">No contacts collected yet for this client.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Activity</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr key={contact.id}>
                      <td>{contact.name || 'Unnamed contact'}</td>
                      <td>{contact.phone}</td>
                      <td>{contact.email || '—'}</td>
                      <td>
                        {contact._count.leads} leads • {contact._count.conversations} threads • {contact._count.appointments} bookings
                      </td>
                      <td>{formatCompactDateTime(contact.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Leads</div>
              <h3 className="section-title">Lead records</h3>
            </div>
          </div>
          {leads.length === 0 ? (
            <div className="empty-state">No leads collected yet for this client.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Phone</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.contact.name || 'Unnamed contact'}</td>
                      <td>{lead.contact.phone || '—'}</td>
                      <td>{lead.source || 'Manual / unknown'}</td>
                      <td>{lead.status}</td>
                      <td>{formatCompactDateTime(lead.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Conversations</div>
              <h3 className="section-title">Recent threads</h3>
            </div>
          </div>
          {conversations.length === 0 ? (
            <div className="empty-state">No conversations yet for this client.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Last message</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conversation) => (
                    <tr key={conversation.id}>
                      <td>{conversation.contact.name || 'Unnamed contact'}</td>
                      <td>{conversation.contact.phone || '—'}</td>
                      <td>{conversation.messages[0] ? `${conversation.messages[0].direction}: ${conversation.messages[0].content.slice(0, 90)}` : 'No messages yet'}</td>
                      <td>{formatCompactDateTime(conversation.messages[0]?.createdAt || conversation.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Bookings</div>
              <h3 className="section-title">Appointment records</h3>
            </div>
          </div>
          {appointments.length === 0 ? (
            <div className="empty-state">No bookings yet for this client.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((appointment) => (
                    <tr key={appointment.id}>
                      <td>{appointment.contact.name || 'Unnamed contact'}</td>
                      <td>{appointment.contact.phone || '—'}</td>
                      <td>{formatCompactDateTime(appointment.startTime)}</td>
                      <td>{appointment.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </LayoutShell>
  );
}
