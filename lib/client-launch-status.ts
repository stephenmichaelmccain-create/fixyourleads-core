import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { clientCalendarSetupProgress, parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { parseTelnyxSetupPayload, telnyxSetupProgress } from '@/lib/client-telnyx-setup';

type LaunchCompany = {
  notificationEmail: string | null;
  website: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  telnyxInboundNumber: string | null;
  telnyxInboundNumbers: Array<{ number: string }>;
};

type LaunchStatusTone = 'ready' | 'warn' | 'pending';

export type LaunchStatusItem = {
  key: 'profile' | 'telnyx' | 'sms' | 'booking' | 'launch';
  label: string;
  tone: LaunchStatusTone;
  value: string;
  detail: string;
  href: string;
};

function isPresent(value: string | null | undefined) {
  return Boolean(String(value || '').trim());
}

function buildProfileStatus(company: LaunchCompany, companyId: string): LaunchStatusItem {
  const requiredFields = [
    company.notificationEmail,
    company.website,
    company.primaryContactName,
    company.primaryContactEmail,
    company.primaryContactPhone
  ];
  const completeCount = requiredFields.filter(isPresent).length;
  const isReady = completeCount === requiredFields.length;

  return {
    key: 'profile',
    label: 'Profile',
    tone: isReady ? 'ready' : 'warn',
    value: isReady ? 'Complete' : `${completeCount}/${requiredFields.length}`,
    detail: isReady ? 'Business details and primary contact are in place.' : 'Finish the core client record before launch.',
    href: `/clients/${companyId}`
  };
}

export function buildLaunchStatusItems(input: {
  company: LaunchCompany;
  companyId: string;
  telnyxPayload: unknown;
  bookingPayload: unknown;
  latestMessagingEventType: string | null;
}) {
  const { company, companyId, telnyxPayload, bookingPayload, latestMessagingEventType } = input;
  const telnyxState = parseTelnyxSetupPayload(telnyxPayload);
  const telnyxProgress = telnyxSetupProgress(telnyxState);
  const bookingState = parseClientCalendarSetupPayload(bookingPayload);
  const bookingProgress = clientCalendarSetupProgress(bookingState);
  const profile = buildProfileStatus(company, companyId);

  const telnyxReady =
    telnyxState.launchApproved ||
    (telnyxState.campaignApproved &&
      telnyxState.numberAssigned &&
      telnyxState.webhookConfigured &&
      telnyxState.testSmsSent &&
      (telnyxState.testReplyReceived || hasInboundRouting(company)));

  const telnyx: LaunchStatusItem = {
    key: 'telnyx',
    label: 'Telnyx',
    tone: telnyxReady ? 'ready' : telnyxProgress.completed > 0 ? 'warn' : 'pending',
    value: telnyxReady ? 'Ready' : `${telnyxProgress.completed}/${telnyxProgress.total}`,
    detail: telnyxReady
      ? `Routing line ${allInboundNumbers(company)[0] || telnyxState.phoneNumber || 'assigned'} is launch-ready.`
      : 'Finish brand, campaign, number, webhook, and reply checks.',
    href: `/clients/${companyId}/telnyx`
  };

  const smsTone: LaunchStatusTone =
    latestMessagingEventType === 'message_received' || telnyxState.testReplyReceived
      ? 'ready'
      : latestMessagingEventType === 'telnyx_message_delivery_failed' || latestMessagingEventType === 'operator_messaging_test_failed'
        ? 'warn'
        : latestMessagingEventType === 'operator_messaging_test_sent' || latestMessagingEventType === 'telnyx_message_sent'
          ? 'pending'
          : 'pending';

  const sms: LaunchStatusItem = {
    key: 'sms',
    label: 'Comms test',
    tone: smsTone,
    value:
      smsTone === 'ready'
        ? 'Reply captured'
        : smsTone === 'warn'
          ? 'Needs fix'
          : latestMessagingEventType
            ? 'In progress'
            : 'Not run',
    detail:
      smsTone === 'ready'
        ? 'A test reply has reached the client thread.'
        : smsTone === 'warn'
          ? 'Recent send or delivery activity still needs operator attention.'
          : 'Use Comms Lab to send a live test and confirm the reply path.',
    href: `/clients/${companyId}/operator?lab=sms`
  };

  const bookingReady =
    bookingState.launchApproved ||
    (bookingState.bookingSourceConfirmed &&
      bookingState.calendarModeChosen &&
      bookingState.writebackConfigured &&
      bookingState.syncTestPassed &&
      bookingState.clientVisibilityConfirmed);

  const booking: LaunchStatusItem = {
    key: 'booking',
    label: 'Booking',
    tone: bookingReady ? 'ready' : bookingProgress.completed > 0 ? 'warn' : 'pending',
    value: bookingReady ? 'Ready' : `${bookingProgress.completed}/${bookingProgress.total}`,
    detail: bookingReady ? 'Destination, writeback, and visibility are confirmed.' : 'Pick a destination and prove booking sync end to end.',
    href: `/clients/${companyId}/booking`
  };

  const launchReady = profile.tone === 'ready' && telnyx.tone === 'ready' && sms.tone === 'ready' && booking.tone === 'ready';
  const launch: LaunchStatusItem = {
    key: 'launch',
    label: 'Launch',
    tone: launchReady ? 'ready' : 'warn',
    value: launchReady ? 'Approved' : 'In progress',
    detail: launchReady ? 'This client is ready for live lead traffic.' : 'Use the five tabs to finish onboarding, test, and monitoring.',
    href: `/clients/${companyId}`
  };

  return [profile, telnyx, sms, booking, launch];
}
