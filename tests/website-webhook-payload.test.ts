import { describe, expect, it } from 'vitest';
import {
  normalizeWebsiteIntakePayload,
  normalizeWebsiteOnboardingPayload,
  readWebsitePayload,
  websiteIntakeSchema,
  websiteOnboardingSchema
} from '../lib/website-webhook-payload';
import { humanizeIntakeSource } from '../lib/client-intake';

describe('website webhook payload normalization', () => {
  it('maps the live lightbox payload into the intake schema', () => {
    const payload = {
      business: 'Test Clinic',
      email: 'owner@testclinic.com',
      form_type: 'book_call_modal',
      name: 'Levi Turner',
      page_url: 'https://fixyourleads.com/#fyl-demo',
      phone: '+17205410251',
      source: 'book_call_modal',
      submitted_at: '2026-04-22T18:23:00.000Z'
    };

    const normalized = normalizeWebsiteIntakePayload(payload);
    expect(normalized).toEqual({
      clinicName: 'Test Clinic',
      contactName: 'Levi Turner',
      notificationEmail: 'owner@testclinic.com',
      phone: '+17205410251',
      website: 'https://fixyourleads.com/#fyl-demo',
      source: 'book_call_modal',
      sourceExternalId: undefined
    });
    expect(websiteIntakeSchema.safeParse(normalized).success).toBe(true);
  });

  it('maps the live full-signup payload into the intake schema', () => {
    const payload = {
      business_name: 'Logogo Designs 2',
      contact_name: 'Levi Turner',
      contact_email: 'turnerlevi245@gmail.com',
      contact_phone: '+17205410251',
      notify_email: 'turnerlevi245@gmail.com',
      website: 'https://logogo.designs',
      form_type: 'signup',
      page_url: 'https://fixyourleads.com/signup',
      source: 'signup',
      submission_id: 'form-123'
    };

    const normalized = normalizeWebsiteIntakePayload(payload);
    expect(normalized).toEqual({
      clinicName: 'Logogo Designs 2',
      contactName: 'Levi Turner',
      notificationEmail: 'turnerlevi245@gmail.com',
      phone: '+17205410251',
      website: 'https://logogo.designs',
      source: 'signup',
      sourceExternalId: 'form-123'
    });
    expect(websiteIntakeSchema.safeParse(normalized).success).toBe(true);
  });

  it('maps the live onboarding payload into the onboarding schema', () => {
    const payload = {
      legal_name: 'Logogo Designs LLC',
      dba_name: 'Logogo',
      rep_name: 'Levi Turner',
      rep_email: 'turnerlevi245@gmail.com',
      rep_phone: '+17205410251',
      website: 'https://logogo.designs',
      vertical: 'cosmetic clinic',
      campaign_description: 'Appointment reminders and follow-ups',
      ein: '12-3456789',
      form_type: 'onboarding',
      source: 'onboarding'
    };

    const normalized = normalizeWebsiteOnboardingPayload(payload);
    expect(normalized).toEqual({
      clinicName: 'Logogo',
      contactName: 'Levi Turner',
      notificationEmail: 'turnerlevi245@gmail.com',
      phone: '+17205410251',
      website: 'https://logogo.designs',
      source: 'onboarding',
      sourceExternalId: undefined,
      businessType: 'cosmetic clinic',
      campaignUseCase: 'Appointment reminders and follow-ups',
      telnyxBrandName: 'Logogo',
      taxIdLast4: '6789'
    });
    expect(websiteOnboardingSchema.safeParse(normalized).success).toBe(true);
  });
});

describe('website webhook payload parsing', () => {
  it('reads urlencoded form submissions', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        business: 'Test Clinic',
        email: 'owner@testclinic.com'
      })
    });

    await expect(readWebsitePayload(request)).resolves.toEqual({
      business: 'Test Clinic',
      email: 'owner@testclinic.com'
    });
  });

  it('reads json submissions', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        business_name: 'Signup Clinic',
        contact_email: 'owner@signupclinic.com'
      })
    });

    await expect(readWebsitePayload(request)).resolves.toEqual({
      business_name: 'Signup Clinic',
      contact_email: 'owner@signupclinic.com'
    });
  });
});

describe('intake source labels', () => {
  it('humanizes known website source keys', () => {
    expect(humanizeIntakeSource('book_call_modal')).toBe('Book a Call');
    expect(humanizeIntakeSource('signup')).toBe('Full signup');
    expect(humanizeIntakeSource('onboarding')).toBe('Onboarding');
  });
});
