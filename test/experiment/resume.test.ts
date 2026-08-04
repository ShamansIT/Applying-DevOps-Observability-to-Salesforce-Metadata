import { describe, expect, it } from 'vitest';
import { attemptReusable, hasValidFingerprint } from '../../src/experiment/pilot.js';
import { experimentChecksums } from '../../src/experiment/storage.js';
import type { FileMap } from '../../src/experiment/mutation.js';

// complete, checksum-verified scenario directory.
function completeScenario(): FileMap {
  const files: FileMap = {
    'scenario.json': '{"id":"cand-x"}\n',
    'attempt.json': '{"status":"complete"}\n',
    'record.json': '{"scenarioId":"cand-x","status":"complete"}\n',
    'prototype.json': '{"predictionCategory":"blocking_finding"}\n',
    'salesforce.json': '{"pollingEvents":[]}\n',
  };
  files['checksums.sha256'] = experimentChecksums(files);
  return files;
}

describe('attemptReusable', () => {
  it('reuses a complete, checksum-verified attempt', () => {
    expect(attemptReusable(completeScenario()).reusable).toBe(true);
  });

  it('reruns an interrupted write - attempt.json but no checksums', () => {
    const files = completeScenario();
    delete files['checksums.sha256'];
    expect(attemptReusable(files).reusable).toBe(false);
  });

  it('reruns when checksums.sha256 is missing', () => {
    const files: FileMap = { 'attempt.json': '{"status":"complete"}\n' };
    expect(attemptReusable(files).reason).toMatch(/checksums/);
  });

  it('reruns a tampered raw file', () => {
    const files = completeScenario();
    files['prototype.json'] = '{"predictionCategory":"tampered"}\n';
    expect(attemptReusable(files).reusable).toBe(false);
  });

  it('reruns a corrupt attempt.json', () => {
    const files = completeScenario();
    files['attempt.json'] = 'not json';
    files['checksums.sha256'] = experimentChecksums(files);
    expect(attemptReusable(files).reason).toMatch(/corrupt/);
  });

  it('reruns an incomplete attempt', () => {
    const files: FileMap = { 'attempt.json': '{"status":"prototype_failed"}\n' };
    files['checksums.sha256'] = experimentChecksums(files);
    expect(attemptReusable(files).reusable).toBe(false);
  });

  it('reruns when an unlisted extra file appears', () => {
    const files = completeScenario();
    files['sneaky.json'] = 'extra\n';
    expect(attemptReusable(files).reusable).toBe(false);
  });
});

describe('hasValidFingerprint', () => {
  it('accepts a well-formed fingerprint', () => {
    expect(hasValidFingerprint('{"gitCommit":"a","registerHash":"b","planHash":"c"}')).toBe(true);
  });

  it('rejects a missing or malformed fingerprint', () => {
    expect(hasValidFingerprint(undefined)).toBe(false);
    expect(hasValidFingerprint('{}')).toBe(false);
    expect(hasValidFingerprint('not json')).toBe(false);
  });
});
