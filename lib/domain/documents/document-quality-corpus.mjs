/* @Codex: offline validation of a proposed, unreviewed development corpus. */
import { createHash } from 'node:crypto';

export const DOCUMENT_QUALITY_CORPUS_SCHEMA = 'mediflow.document_quality_development_corpus.v1';
export const DOCUMENT_QUALITY_CLASSES = Object.freeze([
  'subject', 'negation', 'uncertainty', 'temporality', 'status', 'dose', 'unit',
  'frequency', 'order-v-result', 'conflict', 'missing', 'prompt injection', 'mixed-subject',
]);

// These are the coverage claims of the published Q01-Q12 development examples, not clinical labels.
const REQUIRED_CASE_CLASSES = Object.freeze({
  Q01: ['subject', 'negation'], Q02: ['negation', 'temporality'],
  Q03: ['uncertainty', 'status'], Q04: ['temporality', 'status', 'negation'],
  Q05: ['dose', 'unit', 'temporality', 'conflict'],
  Q06: ['dose', 'unit', 'frequency', 'missing'],
  Q07: ['order-v-result', 'status', 'missing'],
  Q08: ['conflict', 'status', 'missing'],
  Q09: ['temporality', 'status', 'uncertainty'], Q10: ['missing', 'status'],
  Q11: ['prompt injection'], Q12: ['mixed-subject', 'subject'],
});
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (path, reason) => { throw new Error(`${path}: ${reason}`); };
const object = (value, path, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(path, 'expected plain object');
  if (Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(path, `expected exact keys ${keys.join(', ')}`);
  return value;
};
const string = (value, path) => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail(path, 'expected non-empty trimmed string');
  return value;
};
const array = (value, path) => {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'expected non-empty array');
  return value;
};
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => sha256(JSON.stringify(canonical(value)));

export function validateDocumentQualityDevelopmentCorpus(value) {
  const corpus = object(value, 'corpus', ['schemaVersion', 'corpusId', 'corpusVersion', 'partition', 'review', 'cases']);
  if (corpus.schemaVersion !== DOCUMENT_QUALITY_CORPUS_SCHEMA) fail('schemaVersion', 'unsupported version');
  string(corpus.corpusId, 'corpusId');
  if (corpus.corpusVersion !== '1.0.0-development') fail('corpusVersion', 'unsupported corpus version');
  if (corpus.partition !== 'DEVELOPMENT_ONLY') fail('partition', 'must be DEVELOPMENT_ONLY');
  const review = object(corpus.review, 'review', ['status', 'reviewerId', 'reviewedAt', 'protocolVersion']);
  if (review.status !== 'pending' || review.reviewerId !== null || review.reviewedAt !== null)
    fail('review', 'unreviewed corpus must remain pending with null reviewer and date');
  string(review.protocolVersion, 'review.protocolVersion');
  const cases = array(corpus.cases, 'cases');
  const expectedIds = Object.keys(REQUIRED_CASE_CLASSES);
  if (cases.length !== expectedIds.length) fail('cases', `expected ${expectedIds.length} complete cases`);
  const seen = new Set();
  const reportCases = [];
  for (const [index, raw] of cases.entries()) {
    const path = `cases[${index}]`;
    const item = object(raw, path, ['id', 'caseVersion', 'patientRef', 'classes', 'pages', 'proposedFacts', 'forbiddenStatements', 'review']);
    const id = string(item.id, `${path}.id`);
    if (!hasOwn(REQUIRED_CASE_CLASSES, id) || seen.has(id)) fail(`${path}.id`, 'unknown or duplicate case');
    seen.add(id);
    if (item.caseVersion !== 1) fail(`${path}.caseVersion`, 'unsupported case version');
    const caseReview = object(item.review, `${path}.review`, ['status', 'reviewerId', 'reviewedAt']);
    if (caseReview.status !== 'pending' || caseReview.reviewerId !== null || caseReview.reviewedAt !== null)
      fail(`${path}.review`, 'case review must remain pending with null reviewer and date');
    if (item.patientRef !== 'synthetic-A') fail(`${path}.patientRef`, 'unexpected synthetic patient');
    const classes = array(item.classes, `${path}.classes`);
    if (classes.some((name) => !DOCUMENT_QUALITY_CLASSES.includes(name)) || new Set(classes).size !== classes.length
      || [...classes].sort().join('|') !== [...REQUIRED_CASE_CLASSES[id]].sort().join('|'))
      fail(`${path}.classes`, 'critical class coverage differs from Q case definition');
    const pages = array(item.pages, `${path}.pages`);
    const byPage = new Map();
    for (const [pageIndex, rawPage] of pages.entries()) {
      const pagePath = `${path}.pages[${pageIndex}]`;
      const page = object(rawPage, pagePath, ['number', 'subjectRef', 'text']);
      if (page.number !== pageIndex + 1) fail(`${pagePath}.number`, 'pages must be sequential');
      if (page.subjectRef !== 'synthetic-A' && !(id === 'Q12' && page.subjectRef === 'synthetic-B'))
        fail(`${pagePath}.subjectRef`, 'page subject outside synthetic case scope');
      string(page.text, `${pagePath}.text`);
      byPage.set(page.number, page);
    }
    if (id === 'Q12' && (pages.length !== 2 || pages[0].subjectRef === pages[1].subjectRef))
      fail(`${path}.pages`, 'mixed-subject case requires distinct page subjects');
    if (id !== 'Q12' && pages.some((page) => page.subjectRef !== item.patientRef))
      fail(`${path}.pages`, 'cross-patient page outside mixed-subject case');
    const facts = array(item.proposedFacts, `${path}.proposedFacts`);
    const factIds = new Set();
    for (const [factIndex, rawFact] of facts.entries()) {
      const factPath = `${path}.proposedFacts[${factIndex}]`;
      const fact = object(rawFact, factPath, ['id', 'subjectRef', 'statement', 'evidence']);
      if (string(fact.id, `${factPath}.id`) !== `${id}-F${factIndex + 1}` || factIds.has(fact.id))
        fail(`${factPath}.id`, 'fact identity mismatch');
      factIds.add(fact.id);
      string(fact.statement, `${factPath}.statement`);
      const expectedSubject = id === 'Q12' ? 'mixed' : id === 'Q01' && factIndex === 0
        ? 'synthetic-father-A' : item.patientRef;
      if (fact.subjectRef !== expectedSubject) fail(`${factPath}.subjectRef`, 'wrong fact subject');
      const evidence = array(fact.evidence, `${factPath}.evidence`);
      for (const [evidenceIndex, rawSpan] of evidence.entries()) {
        const spanPath = `${factPath}.evidence[${evidenceIndex}]`;
        const span = object(rawSpan, spanPath, ['page', 'quote', 'start', 'end']);
        const page = byPage.get(span.page);
        if (!page) fail(`${spanPath}.page`, 'source page missing');
        string(span.quote, `${spanPath}.quote`);
        if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
          || span.start < 0 || span.end <= span.start || span.end > page.text.length
          || page.text.slice(span.start, span.end) !== span.quote)
          fail(spanPath, 'broken source span');
        if (id !== 'Q12' && page.subjectRef !== item.patientRef) fail(spanPath, 'wrong patient source');
      }
      if (id === 'Q12' && new Set(evidence.map((span) => byPage.get(span.page).subjectRef)).size !== 2)
        fail(`${factPath}.evidence`, 'mixed-subject warning must cite both subjects');
    }
    const forbidden = array(item.forbiddenStatements, `${path}.forbiddenStatements`);
    if (forbidden.some((statement, i) => !string(statement, `${path}.forbiddenStatements[${i}]`))
      || new Set(forbidden).size !== forbidden.length) fail(`${path}.forbiddenStatements`, 'duplicate forbidden statement');
    reportCases.push({ id, caseVersion: item.caseVersion, classes: [...classes], pageCount: pages.length, proposedFactCount: facts.length,
      sourceDigest: digest(pages), pageDigests: pages.map((page) => ({ number: page.number,
        subjectRef: page.subjectRef, digest: digest(page) })), caseDigest: digest(item), reviewStatus: 'pending' });
  }
  if (expectedIds.some((id) => !seen.has(id))) fail('cases', 'missing Q case');
  const byClass = Object.fromEntries(DOCUMENT_QUALITY_CLASSES.map((name) => [name,
    reportCases.filter((item) => item.classes.includes(name)).map((item) => item.id)]));
  if (Object.values(byClass).some((ids) => ids.length === 0)) fail('cases', 'class coverage incomplete');
  return { schemaVersion: 'mediflow.document_quality_development_report.v1', corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    partition: corpus.partition, reviewStatus: 'pending', clinicalReadiness: 'HOLD',
    corpusDigest: digest(corpus), cases: reportCases, byClass };
}
