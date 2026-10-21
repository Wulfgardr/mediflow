import path from 'node:path';

export function assertBaseProfiles(bundle) {
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    if (value.resourceType) {
      for (const profile of value.meta?.profile ?? []) {
        if (profile !== `http://hl7.org/fhir/StructureDefinition/${value.resourceType}`) throw new Error('UNLOCKED_PROFILE_CLAIM');
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(inspect);
      else inspect(child);
    }
  };
  inspect(bundle);
}
export function readOutcomes(output, artifacts) {
  if (output.resourceType !== 'Bundle' || !Array.isArray(output.entry)) throw new Error('TOOL_OUTCOME_BUNDLE_REQUIRED');
  const found = new Map();
  for (const { resource } of output.entry) {
    if (resource?.resourceType !== 'OperationOutcome' || !Array.isArray(resource.issue)) throw new Error('TOOL_INVALID_OPERATION_OUTCOME');
    const sources = (resource.extension ?? []).filter(ext => ext.url.endsWith('operationoutcome-file')).map(ext => ext.valueString);
    if (sources.length !== 1 || typeof sources[0] !== 'string') throw new Error('TOOL_OUTCOME_SOURCE_REQUIRED');
    const file = path.basename(sources[0]);
    if (!artifacts.some(artifact => artifact.file === file) || found.has(file)) throw new Error('TOOL_OUTCOME_SOURCE_MISMATCH');
    const issues = resource.issue.map(issue => {
      if (!['fatal', 'error', 'warning', 'information', 'success'].includes(issue.severity) || typeof issue.code !== 'string') throw new Error('TOOL_INVALID_ISSUE');
      const messageExtension = (issue.extension ?? []).find(ext => ext.url.endsWith('operationoutcome-message-id'));
      const messageId = messageExtension?.valueCode ?? messageExtension?.valueString
        ?? issue.details?.coding?.find(coding => coding.code)?.code;
      const locations = issue.expression?.length ? issue.expression : issue.location;
      return {
        severity: issue.severity, identifier: messageId ?? issue.code,
        path: locations?.join(' | ') ?? '', message: issue.details?.text ?? issue.diagnostics ?? '',
      };
    });
    found.set(file, issues);
  }
  if (found.size !== artifacts.length) throw new Error('TOOL_MISSING_OUTCOME');
  return found;
}
export const issueKey = issue => JSON.stringify([issue.artifact, issue.severity, issue.identifier, issue.path, issue.message]);
export function assessIssues(artifacts, outcomes, baseline) {
  const entries = baseline.entries;
  if (!Array.isArray(entries) || entries.some(entry => !entry.reason?.trim() || !entry.identifier || !entry.path || !entry.artifact || !Number.isInteger(entry.count) || entry.count < 1)
      || new Set(entries.map(issueKey)).size !== entries.length) throw new Error('INVALID_REVIEWED_BASELINE');
  const observed = new Map();
  for (const artifact of artifacts) {
    for (const issue of outcomes.get(artifact.file) ?? []) {
      if (!['error', 'fatal', 'warning'].includes(issue.severity)) continue;
      const item = { artifact: artifact.id, ...issue };
      const key = issueKey(item);
      const existing = observed.get(key);
      if (existing) existing.count += 1;
      else observed.set(key, { ...item, count: 1 });
    }
  }
  const known = [], fresh = [], stale = [];
  for (const [key, issue] of observed) {
    const match = entries.find(entry => issueKey(entry) === key);
    if (match) {
      known.push({ ...issue, count: Math.min(issue.count, match.count), reason: match.reason });
      if (issue.count > match.count) fresh.push({ ...issue, count: issue.count - match.count });
    } else fresh.push(issue);
  }
  for (const entry of entries) {
    const count = observed.get(issueKey(entry))?.count ?? 0;
    if (count < entry.count) stale.push({ ...entry, count: entry.count - count, action: 'REMOVE_FROM_BASELINE' });
  }
  return { known, new: fresh, stale, passed: !fresh.length && !stale.length };
}
