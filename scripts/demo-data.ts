import { LeadStatus, MessageDirection, PrismaClient, ProspectStatus } from '@prisma/client';
import { DEMO_PREFIX, DEMO_PROSPECT_COMPANY_ID, labelAsDemo } from '../lib/demo';

const prisma = new PrismaClient();

type DemoProspect = {
  name: string;
  city: string;
  phone: string;
  website: string;
  ownerName: string;
  status: ProspectStatus;
  lastCallOutcome: string | null;
  lastCallAt?: Date;
  nextActionAt: Date | null;
  notes: string;
};

type DemoThreadMessage = {
  direction: MessageDirection;
  content: string;
  createdAt: Date;
};

type DemoClientContact = {
  name: string;
  phone: string;
  leadStatus: LeadStatus;
  source: string;
  lastContactedAt?: Date;
  lastRepliedAt?: Date;
  thread: DemoThreadMessage[];
  bookingAt?: Date;
};

type DemoClient = {
  name: string;
  notificationEmail: string | null;
  telnyxNumbers: string[];
  contacts: DemoClientContact[];
};

function daysAgo(days: number, hour = 10) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  value.setHours(hour, 0, 0, 0);
  return value;
}

function daysFromNow(days: number, hour = 10) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value;
}

const demoProspects: DemoProspect[] = [
  {
    name: labelAsDemo('Cherry Creek Aesthetic Clinic'),
    city: 'Denver',
    phone: '+13035550101',
    website: 'cherrycreek-demo-clinic.com',
    ownerName: 'Lauren Meyers',
    status: ProspectStatus.NEW,
    lastCallOutcome: null,
    nextActionAt: daysFromNow(0, 11),
    notes: 'Clinic type: Med spa. ZIP focus: 80206. Predicted annual revenue: $2.4M. First-call script should lead with missed call and text relief.'
  },
  {
    name: labelAsDemo('Lakeside Family Dental'),
    city: 'Austin',
    phone: '+15125550102',
    website: 'lakeside-demo-dental.com',
    ownerName: 'Dr. Evan Cole',
    status: ProspectStatus.NO_ANSWER,
    lastCallOutcome: 'No answer',
    lastCallAt: daysAgo(1, 14),
    nextActionAt: daysFromNow(1, 9),
    notes: 'Clinic type: Dental. ZIP focus: 78704. Predicted annual revenue: $3.1M. Retry as soon as possible tomorrow morning.'
  },
  {
    name: labelAsDemo('Sunset Chiropractic Studio'),
    city: 'Nashville',
    phone: '+16155550103',
    website: 'sunset-demo-chiro.com',
    ownerName: 'Mara Lewis',
    status: ProspectStatus.VM_LEFT,
    lastCallOutcome: 'Voicemail left',
    lastCallAt: daysAgo(0, 15),
    nextActionAt: daysFromNow(2, 10),
    notes: 'Clinic type: Chiropractic. ZIP focus: 37203. Predicted annual revenue: $1.8M. Good voicemail opener already tested.'
  },
  {
    name: labelAsDemo('Peak Wellness Clinic'),
    city: 'Phoenix',
    phone: '+16025550104',
    website: 'peak-demo-wellness.com',
    ownerName: 'Ari Patel',
    status: ProspectStatus.GATEKEEPER,
    lastCallOutcome: 'Front desk asked for a callback next week',
    lastCallAt: daysAgo(0, 13),
    nextActionAt: daysFromNow(7, 10),
    notes: 'Clinic type: Wellness clinic. ZIP focus: 85016. Predicted annual revenue: $1.4M. Gatekeeper wants owner called next Tuesday.'
  },
  {
    name: labelAsDemo('North Loop Dermatology'),
    city: 'Houston',
    phone: '+17135550105',
    website: 'northloop-demo-derm.com',
    ownerName: 'Dr. Priya Shah',
    status: ProspectStatus.BOOKED_DEMO,
    lastCallOutcome: 'Booked intro call for next week',
    lastCallAt: daysAgo(0, 12),
    nextActionAt: daysFromNow(5, 14),
    notes: 'Clinic type: Dermatology. ZIP focus: 77008. Predicted annual revenue: $3.6M. Highlight for meeting prep and confirmation.'
  },
  {
    name: labelAsDemo('Stonegate Urgent Care'),
    city: 'Dallas',
    phone: '+12145550106',
    website: 'stonegate-demo-urgent.com',
    ownerName: 'Rachel Kim',
    status: ProspectStatus.DEAD,
    lastCallOutcome: 'Very not interested - requested no further outreach',
    lastCallAt: daysAgo(6, 11),
    nextActionAt: null,
    notes: 'Clinic type: Urgent care. ZIP focus: 75219. Predicted annual revenue: $4.0M. Treat as do-not-contact.'
  },
  {
    name: labelAsDemo('Harmony Physical Therapy'),
    city: 'Tampa',
    phone: '+18135550107',
    website: 'harmony-demo-pt.com',
    ownerName: 'Benita Cruz',
    status: ProspectStatus.CLOSED,
    lastCallOutcome: 'Sold - waiting for website signup',
    lastCallAt: daysAgo(0, 16),
    nextActionAt: daysFromNow(2, 9),
    notes: 'Clinic type: Physical therapy. ZIP focus: 33606. Predicted annual revenue: $2.2M. Sold and should move into waiting-for-signup.'
  },
  {
    name: labelAsDemo('Blue Ridge Hormone Clinic'),
    city: 'Charlotte',
    phone: '+17045550108',
    website: 'blueridge-demo-hormone.com',
    ownerName: 'Marcus Flynn',
    status: ProspectStatus.NO_ANSWER,
    lastCallOutcome: 'No answer on first touch',
    lastCallAt: daysAgo(2, 10),
    nextActionAt: daysFromNow(0, 15),
    notes: 'Clinic type: Hormone clinic. ZIP focus: 28203. Predicted annual revenue: $2.7M. Good candidate for same-day retry before close.'
  }
] ;

const demoClients: DemoClient[] = [
  {
    name: labelAsDemo('Denver South Hair Clinic'),
    notificationEmail: 'ops@demo.fixyourleads.local',
    telnyxNumbers: ['+13035551001', '+13035551002'],
    contacts: [
      {
        name: 'Maya Carter',
        phone: '+13035552001',
        leadStatus: LeadStatus.REPLIED,
        source: 'Website form',
        lastContactedAt: daysAgo(0, 9),
        lastRepliedAt: daysAgo(0, 10),
        thread: [
          { direction: MessageDirection.OUTBOUND, content: 'Hi Maya, this is Fix Your Leads confirming your hair consultation request.', createdAt: daysAgo(0, 9) },
          { direction: MessageDirection.INBOUND, content: 'Yes please, I wanted to come in Friday afternoon if possible.', createdAt: daysAgo(0, 10) }
        ],
        bookingAt: daysFromNow(2, 14)
      },
      {
        name: 'Sienna Ortiz',
        phone: '+13035552002',
        leadStatus: LeadStatus.CONTACTED,
        source: 'Google ad',
        lastContactedAt: daysAgo(0, 13),
        thread: [
          { direction: MessageDirection.OUTBOUND, content: 'Hi Sienna, just checking in after your request for balayage pricing.', createdAt: daysAgo(0, 13) }
        ]
      },
      {
        name: 'Taylor Green',
        phone: '+13035552003',
        leadStatus: LeadStatus.NEW,
        source: 'Instagram DM',
        thread: []
      }
    ]
  },
  {
    name: labelAsDemo('Sunset Dental Group'),
    notificationEmail: 'frontdesk@demo.fixyourleads.local',
    telnyxNumbers: ['+15125551003'],
    contacts: [
      {
        name: 'Jordan Brooks',
        phone: '+15125552001',
        leadStatus: LeadStatus.BOOKED,
        source: 'New patient landing page',
        lastContactedAt: daysAgo(1, 11),
        lastRepliedAt: daysAgo(1, 12),
        thread: [
          { direction: MessageDirection.OUTBOUND, content: 'Hi Jordan, I can help get your cleaning booked this week.', createdAt: daysAgo(1, 11) },
          { direction: MessageDirection.INBOUND, content: 'That works, can you do Thursday morning?', createdAt: daysAgo(1, 12) }
        ],
        bookingAt: daysFromNow(1, 9)
      },
      {
        name: 'Harper Wells',
        phone: '+15125552002',
        leadStatus: LeadStatus.SUPPRESSED,
        source: 'Referral',
        lastContactedAt: daysAgo(4, 15),
        thread: [
          { direction: MessageDirection.OUTBOUND, content: 'Hi Harper, following up on your dental implant request.', createdAt: daysAgo(4, 15) }
        ]
      }
    ]
  },
  {
    name: labelAsDemo('Lakeside Chiropractic Clinic'),
    notificationEmail: 'bookings@demo.fixyourleads.local',
    telnyxNumbers: ['+16155551004'],
    contacts: [
      {
        name: 'Noah Bennett',
        phone: '+16155552001',
        leadStatus: LeadStatus.CONTACTED,
        source: 'Walk-in callback',
        lastContactedAt: daysAgo(0, 8),
        thread: [
          { direction: MessageDirection.OUTBOUND, content: 'Hi Noah, wanted to confirm your lower back consult request.', createdAt: daysAgo(0, 8) }
        ]
      },
      {
        name: 'Avery Stone',
        phone: '+16155552002',
        leadStatus: LeadStatus.REPLIED,
        source: 'Google Maps import',
        lastContactedAt: daysAgo(0, 10),
        lastRepliedAt: daysAgo(0, 11),
        thread: [
          { direction: MessageDirection.OUTBOUND, content: 'Hi Avery, we can help get you in for an adjustment this week.', createdAt: daysAgo(0, 10) },
          { direction: MessageDirection.INBOUND, content: 'Perfect, I need something after work tomorrow.', createdAt: daysAgo(0, 11) }
        ]
      }
    ]
  },
  {
    name: labelAsDemo('Glow Med Spa Collective'),
    notificationEmail: null,
    telnyxNumbers: [],
    contacts: [
      {
        name: 'Morgan Price',
        phone: '+17135552001',
        leadStatus: LeadStatus.NEW,
        source: 'Website assistant',
        thread: []
      }
    ]
  }
];

async function clearDemoData() {
  const demoCompanies = await prisma.company.findMany({
    where: { name: { startsWith: DEMO_PREFIX } },
    select: { id: true }
  });
  const demoCompanyIds = demoCompanies.map((company) => company.id);

  if (demoCompanyIds.length > 0) {
    await prisma.companyTelnyxNumber.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
    await prisma.eventLog.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
    await prisma.message.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
    await prisma.appointment.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
    await prisma.conversation.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
    await prisma.lead.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: demoCompanyIds } } });
  }

  await prisma.callLog.deleteMany({
    where: {
      prospect: {
        companyId: DEMO_PROSPECT_COMPANY_ID
      }
    }
  });
  await prisma.prospect.deleteMany({
    where: {
      OR: [{ companyId: DEMO_PROSPECT_COMPANY_ID }, { name: { startsWith: DEMO_PREFIX } }]
    }
  });
}

async function seedDemoProspects() {
  for (const prospect of demoProspects) {
    await prisma.prospect.create({
      data: {
        companyId: DEMO_PROSPECT_COMPANY_ID,
        name: prospect.name,
        city: prospect.city,
        phone: prospect.phone,
        website: prospect.website,
        ownerName: prospect.ownerName,
        status: prospect.status,
        lastCallAt: prospect.lastCallAt ?? null,
        lastCallOutcome: prospect.lastCallOutcome,
        nextActionAt: prospect.nextActionAt,
        notes: prospect.notes,
        callLogs:
          prospect.lastCallOutcome
            ? {
                create: {
                  outcome: prospect.lastCallOutcome,
                  durationSeconds: 94,
                  notes: prospect.notes
                }
              }
            : undefined
      }
    });
  }
}

async function seedDemoClients() {
  for (const client of demoClients) {
    const company = await prisma.company.create({
      data: {
        name: client.name,
        notificationEmail: client.notificationEmail,
        telnyxInboundNumber: client.telnyxNumbers[0] ?? null,
        telnyxInboundNumbers: {
          create: client.telnyxNumbers.map((number) => ({ number }))
        }
      }
    });

    await prisma.eventLog.create({
      data: {
        companyId: company.id,
        eventType: 'demo_client_seeded',
        payload: {
          clientName: client.name,
          demo: true
        }
      }
    });

    for (const contactInput of client.contacts) {
      const contact = await prisma.contact.create({
        data: {
          companyId: company.id,
          name: contactInput.name,
          phone: contactInput.phone
        }
      });

      const lead = await prisma.lead.create({
        data: {
          companyId: company.id,
          contactId: contact.id,
          status: contactInput.leadStatus,
          source: contactInput.source,
          lastContactedAt: contactInput.lastContactedAt ?? null,
          lastRepliedAt: contactInput.lastRepliedAt ?? null,
          suppressedAt: contactInput.leadStatus === LeadStatus.SUPPRESSED ? daysAgo(4, 16) : null,
          suppressionReason: contactInput.leadStatus === LeadStatus.SUPPRESSED ? 'Demo do-not-contact state' : null
        }
      });

      await prisma.eventLog.create({
        data: {
          companyId: company.id,
          eventType: 'lead_created',
          payload: {
            contactName: contactInput.name,
            leadId: lead.id,
            source: contactInput.source,
            demo: true
          }
        }
      });

      if (contactInput.thread.length > 0) {
        const conversation = await prisma.conversation.create({
          data: {
            companyId: company.id,
            contactId: contact.id
          }
        });

        for (let index = 0; index < contactInput.thread.length; index += 1) {
          const message = contactInput.thread[index];
          const createdMessage = await prisma.message.create({
            data: {
              companyId: company.id,
              conversationId: conversation.id,
              direction: message.direction,
              content: message.content,
              externalId: `demo-${conversation.id}-${index + 1}`,
              createdAt: message.createdAt
            }
          });

          await prisma.eventLog.create({
            data: {
              companyId: company.id,
              eventType:
                message.direction === MessageDirection.OUTBOUND ? 'telnyx_message_finalized' : 'telnyx_message_received',
              payload: {
                messageId: createdMessage.id,
                externalId: createdMessage.externalId,
                contactName: contactInput.name,
                demo: true
              }
            }
          });
        }
      }

      if (contactInput.bookingAt) {
        await prisma.appointment.create({
          data: {
            companyId: company.id,
            contactId: contact.id,
            startTime: contactInput.bookingAt
          }
        });
      }
    }
  }
}

async function main() {
  const mode = process.argv[2] || 'seed';

  if (mode !== 'seed' && mode !== 'clear') {
    throw new Error('Use `seed` or `clear`.');
  }

  if (mode === 'clear') {
    await clearDemoData();
    console.log('Cleared all demo clients and demo prospects.');
    return;
  }

  await clearDemoData();
  await seedDemoProspects();
  await seedDemoClients();
  console.log('Seeded demo prospects and demo clients.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
