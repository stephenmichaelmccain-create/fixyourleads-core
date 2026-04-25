import nodemailer from 'nodemailer';

type BookingNotificationInput = {
  companyName: string;
  contactName?: string | null;
  contactPhone: string;
  appointmentTime: Date;
  to?: string | null;
};

type ReviewAlertNotificationInput = {
  companyName: string;
  customerName?: string | null;
  customerPhone?: string | null;
  score: number;
  feedbackText?: string | null;
  appointmentId?: string | null;
  to?: string | null;
};

type VoiceDemoProspectNotificationInput = {
  to?: string | null;
  fullName: string;
  calendlyUrl: string;
};

type VoiceDemoOwnerNotificationInput = {
  to?: string | null;
  fullName: string;
  email: string;
  phone: string;
  businessName: string;
  businessType?: string | null;
  preferredTime?: string | null;
  reason?: string | null;
  calendlyUrl: string;
  leadUrl?: string | null;
};

type CrmSyncFailureNotificationInput = {
  to?: string | null;
  companyName: string;
  provider: string;
  error: string;
  leadName?: string | null;
  leadPhone?: string | null;
};

type NotificationResult =
  | {
      status: 'sent';
      detail: string;
      messageId: string;
    }
  | {
      status: 'skipped';
      detail: string;
    }
  | {
      status: 'failed';
      detail: string;
    };

function smtpConfig() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true') === 'true';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASSWORD || '';
  const from = process.env.NOTIFICATION_FROM_EMAIL || user;

  return {
    host,
    port,
    secure,
    user,
    pass,
    from
  };
}

export function notificationReadiness() {
  const config = smtpConfig();

  return {
    smtpUserSet: Boolean(config.user),
    smtpPasswordSet: Boolean(config.pass),
    notificationFromSet: Boolean(config.from)
  };
}

export function bookingNotificationReadiness(notificationEmail?: string | null) {
  const readiness = notificationReadiness();
  const hasNotificationEmail = Boolean(notificationEmail);
  const smtpReady = readiness.smtpUserSet && readiness.smtpPasswordSet;

  if (hasNotificationEmail && smtpReady) {
    return {
      status: 'ready' as const,
      label: 'Ready',
      detail: 'Bookings can notify the clinic automatically.'
    };
  }

  if (!hasNotificationEmail && !smtpReady) {
    return {
      status: 'blocked' as const,
      label: 'Email + SMTP missing',
      detail: 'Add the clinic email in Clients and SMTP credentials in System Status before trusting booking emails.'
    };
  }

  if (!hasNotificationEmail) {
    return {
      status: 'blocked' as const,
      label: 'Clinic email missing',
      detail: 'Add the clinic notification email in Clients before relying on booking emails.'
    };
  }

  return {
    status: 'blocked' as const,
    label: 'SMTP missing',
    detail: 'Company email is set, but SMTP_USER and SMTP_PASSWORD still need to be configured globally.'
  };
}

export async function sendBookingNotification(input: BookingNotificationInput): Promise<NotificationResult> {
  if (!input.to) {
    return {
      status: 'skipped',
      detail: 'company_notification_email_missing'
    };
  }

  const config = smtpConfig();

  if (!config.user || !config.pass || !config.from) {
    return {
      status: 'skipped',
      detail: 'smtp_not_configured'
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  const timeText = input.appointmentTime.toLocaleString();
  const contactName = input.contactName || 'Unnamed contact';

  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: input.to,
      subject: `Booked appointment for ${contactName}`,
      text: [
        `A new FixYourLeads appointment was booked for ${input.companyName}.`,
        '',
        `Contact: ${contactName}`,
        `Phone: ${input.contactPhone}`,
        `Appointment time: ${timeText}`
      ].join('\n')
    });

    return {
      status: 'sent',
      detail: `notification sent to ${input.to}`,
      messageId: info.messageId
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'notification_send_failed'
    };
  }
}

export async function sendReviewAlertNotification(input: ReviewAlertNotificationInput): Promise<NotificationResult> {
  if (!input.to) {
    return {
      status: 'skipped',
      detail: 'review_alert_destination_missing'
    };
  }

  const config = smtpConfig();

  if (!config.user || !config.pass || !config.from) {
    return {
      status: 'skipped',
      detail: 'smtp_not_configured'
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  const customerName = input.customerName || 'Unnamed customer';

  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: input.to,
      subject: `Low visit rating for ${input.companyName}`,
      text: [
        `A recent customer sent a low satisfaction rating for ${input.companyName}.`,
        '',
        `Customer: ${customerName}`,
        `Phone: ${input.customerPhone || 'Unknown'}`,
        `Score: ${input.score}/10`,
        `Appointment ID: ${input.appointmentId || 'Unknown'}`,
        '',
        `Latest reply: ${input.feedbackText || 'No message captured'}`
      ].join('\n')
    });

    return {
      status: 'sent',
      detail: `review alert sent to ${input.to}`,
      messageId: info.messageId
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'review_alert_send_failed'
    };
  }
}

export async function sendVoiceDemoProspectNotification(
  input: VoiceDemoProspectNotificationInput
): Promise<NotificationResult> {
  if (!input.to) {
    return {
      status: 'skipped',
      detail: 'voice_demo_prospect_email_missing'
    };
  }

  const config = smtpConfig();

  if (!config.user || !config.pass || !config.from) {
    return {
      status: 'skipped',
      detail: 'smtp_not_configured'
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: input.to,
      subject: 'Book your Fix Your Leads demo',
      text: [
        `Hi ${input.fullName},`,
        '',
        'Thanks for calling Fix Your Leads. Here is the demo booking link:',
        input.calendlyUrl,
        '',
        'Pick any time that works and we will talk soon.',
        '',
        'Fix Your Leads'
      ].join('\n')
    });

    return {
      status: 'sent',
      detail: `voice demo link sent to ${input.to}`,
      messageId: info.messageId
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'voice_demo_prospect_email_failed'
    };
  }
}

export async function sendVoiceDemoOwnerNotification(
  input: VoiceDemoOwnerNotificationInput
): Promise<NotificationResult> {
  if (!input.to) {
    return {
      status: 'skipped',
      detail: 'voice_demo_owner_email_missing'
    };
  }

  const config = smtpConfig();

  if (!config.user || !config.pass || !config.from) {
    return {
      status: 'skipped',
      detail: 'smtp_not_configured'
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: input.to,
      subject: `New voice demo lead: ${input.businessName}`,
      text: [
        'A caller asked to book a Fix Your Leads demo through the AI voice agent.',
        '',
        `Name: ${input.fullName}`,
        `Business: ${input.businessName}`,
        `Business type: ${input.businessType || 'Not captured'}`,
        `Phone: ${input.phone}`,
        `Email: ${input.email}`,
        `Preferred time: ${input.preferredTime || 'Not captured'}`,
        `Reason: ${input.reason || 'Not captured'}`,
        `Calendly link sent: ${input.calendlyUrl}`,
        input.leadUrl ? `Lead: ${input.leadUrl}` : null
      ]
        .filter(Boolean)
        .join('\n')
    });

    return {
      status: 'sent',
      detail: `voice demo owner notification sent to ${input.to}`,
      messageId: info.messageId
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'voice_demo_owner_email_failed'
    };
  }
}

export async function sendCrmSyncFailureNotification(
  input: CrmSyncFailureNotificationInput
): Promise<NotificationResult> {
  if (!input.to) {
    return {
      status: 'skipped',
      detail: 'crm_sync_failure_email_missing'
    };
  }

  const config = smtpConfig();

  if (!config.user || !config.pass || !config.from) {
    return {
      status: 'skipped',
      detail: 'smtp_not_configured'
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: input.to,
      subject: `CRM sync failed for ${input.companyName}`,
      text: [
        `CRM sync failed after retries for ${input.companyName}.`,
        '',
        `Provider: ${input.provider}`,
        `Lead: ${input.leadName || 'Unknown'}`,
        `Phone: ${input.leadPhone || 'Unknown'}`,
        '',
        `Error: ${input.error}`
      ].join('\n')
    });

    return {
      status: 'sent',
      detail: `crm sync failure sent to ${input.to}`,
      messageId: info.messageId
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'crm_sync_failure_email_failed'
    };
  }
}
