const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

function trimTrailingPunctuation(value: string) {
  return value.replace(/[),.;!?]+$/g, '');
}

function normalizedHostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isRecognizedMeetingHost(hostname: string) {
  return (
    hostname === 'meet.google.com' ||
    hostname === 'zoom.us' ||
    hostname.endsWith('.zoom.us') ||
    hostname === 'teams.microsoft.com' ||
    hostname.endsWith('.teams.microsoft.com')
  );
}

export function extractMeetingLink(notes?: string | null) {
  if (!notes) {
    return null;
  }

  const candidates = Array.from(notes.matchAll(URL_PATTERN), (match) => trimTrailingPunctuation(match[0]));
  const recognizedLink = candidates.find((candidate) => isRecognizedMeetingHost(normalizedHostname(candidate)));

  return recognizedLink || null;
}

export function meetingLinkLabel(url: string) {
  const hostname = normalizedHostname(url);

  if (hostname === 'meet.google.com') {
    return 'Google Meet';
  }

  if (hostname === 'zoom.us' || hostname.endsWith('.zoom.us')) {
    return 'Zoom';
  }

  if (hostname === 'teams.microsoft.com' || hostname.endsWith('.teams.microsoft.com')) {
    return 'Microsoft Teams';
  }

  return 'Meeting link';
}
