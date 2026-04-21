import nodemailer from 'nodemailer';

type BookingNotificationInput = {
  companyName: string;
  contactName?: string | null;
  contactPhone: string;
  appointmentTime: Date;
  to?: string | null;
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
