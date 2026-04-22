import { describe, expect, it } from 'vitest';
import { isLikelyTestProspectName, isLikelyTestWorkspaceName } from '../lib/test-workspaces';

describe('test workspace matching', () => {
  it('matches explicit workspace names and demo labels', () => {
    expect(isLikelyTestWorkspaceName('stephen')).toBe(true);
    expect(isLikelyTestWorkspaceName('Fix Your Leads')).toBe(true);
    expect(isLikelyTestWorkspaceName('[DEMO] Cherry Creek Aesthetic Clinic')).toBe(true);
  });

  it('matches obvious throwaway signup names', () => {
    expect(isLikelyTestWorkspaceName('TESTTTTTING')).toBe(true);
    expect(isLikelyTestWorkspaceName('sdasd')).toBe(true);
    expect(isLikelyTestWorkspaceName('Logogo')).toBe(true);
  });

  it('does not flag normal client names', () => {
    expect(isLikelyTestWorkspaceName('Denver South Hair Clinic')).toBe(false);
    expect(isLikelyTestWorkspaceName('Sunset Dental Group')).toBe(false);
  });

  it('matches demo and throwaway prospect names', () => {
    expect(isLikelyTestProspectName('[DEMO] Lakeside Family Dental')).toBe(true);
    expect(isLikelyTestProspectName('test clinic')).toBe(true);
    expect(isLikelyTestProspectName('Austin Aesthetic Studio')).toBe(false);
  });
});
