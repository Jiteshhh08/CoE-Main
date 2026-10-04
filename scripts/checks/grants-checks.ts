/**
 * Assert-based checks for the grants collector response parser.
 * Run: npx tsx --env-file=.env scripts/checks/grants-checks.ts
 * Covers: bare JSON array, ```json fenced, prose-wrapped, non-array, malformed.
 * No DB access — pure function checks only.
 */
import assert from 'node:assert/strict';
import { parseGrantJson } from '../../src/lib/grants/automation';

let passed = 0;
const ok = (name: string) => {
  passed += 1;
  console.log(`  ✓ ${name}`);
};

const SAMPLE = {
  title: 'Core Research Grant (CRG)',
  issuingBody: 'SERB',
  category: 'RESEARCH_FUND',
  description: 'Funds basic and applied research across science and engineering.',
  deadline: '2026-10-31',
  referenceLink: 'https://www.serbonline.in',
  deadlineTentative: false,
};

function checkBareArray() {
  const out = parseGrantJson(JSON.stringify([SAMPLE]));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, SAMPLE.title);
  ok('bare JSON array');
}

function checkFenced() {
  const out = parseGrantJson('```json\n' + JSON.stringify([SAMPLE]) + '\n```');
  assert.equal(out.length, 1);
  assert.equal(out[0].referenceLink, SAMPLE.referenceLink);
  ok('```json fenced response');
}

function checkProseWrapped() {
  const text =
    'Here are the verified opportunities I found:\n' +
    JSON.stringify([SAMPLE]) +
    '\nLet me know if you need anything else.';
  const out = parseGrantJson(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].deadline, SAMPLE.deadline);
  ok('prose-wrapped response');
}

function checkNonArrayThrows() {
  assert.throws(() => parseGrantJson(JSON.stringify({ not: 'an array' })), /not an array|No JSON array found/);
  ok('non-array input throws');
}

function checkMalformedThrows() {
  assert.throws(() => parseGrantJson('this is not json at all {{{'), /No JSON array found|Unexpected token/);
  ok('malformed input throws');
}

checkBareArray();
checkFenced();
checkProseWrapped();
checkNonArrayThrows();
checkMalformedThrows();
console.log(`grants-checks: ${passed} passed`);
