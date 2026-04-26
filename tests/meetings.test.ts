import { describe, expect, it } from 'vitest';
import { extractMeetingLink, meetingLinkLabel } from '../lib/meetings';

describe('meetings helpers', () => {
  it('prefers a recognized meeting URL from notes', () => {
    const notes = 'Customer asked us to join here: https://meet.google.com/abc-defg-hij and keep the CRM note updated.';

    expect(extractMeetingLink(notes)).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('ignores non-meeting URLs in notes', () => {
    const notes = 'Prep doc: https://docs.google.com/document/d/123/edit';

    expect(extractMeetingLink(notes)).toBeNull();
  });

  it('strips trailing punctuation from the saved link', () => {
    const notes = 'Zoom room: https://acme.zoom.us/j/1234567890.';

    expect(extractMeetingLink(notes)).toBe('https://acme.zoom.us/j/1234567890');
  });

  it('labels supported meeting hosts cleanly', () => {
    expect(meetingLinkLabel('https://meet.google.com/abc-defg-hij')).toBe('Google Meet');
    expect(meetingLinkLabel('https://acme.zoom.us/j/1234567890')).toBe('Zoom');
    expect(meetingLinkLabel('https://teams.microsoft.com/l/meetup-join/123')).toBe('Microsoft Teams');
  });
});
