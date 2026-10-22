/**
 * Regression check for opportunity-creation authorization.
 *
 * Calls the real route handler with real signed tokens rather than asserting on
 * the source text, so re-widening the guard fails here. Every case returns
 * before Prisma is touched: the ADMIN case is deliberately given an invalid body
 * so it stops at validation (400) — that proves the guard let it through without
 * writing a row.
 *
 *   npx --yes tsx --env-file=.env scripts/checks/opportunities-authz-checks.ts
 */
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { POST } from '../../src/app/api/opportunities/route';

let passed = 0;

function check(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    passed += 1;
    console.log(`  ok  ${name}`);
  });
}

const SECRET = process.env.JWT_ACCESS_SECRET;
if (!SECRET) {
  console.error('JWT_ACCESS_SECRET is required (run with --env-file=.env)');
  process.exit(1);
}

function tokenFor(role: string, id = 1): string {
  return jwt.sign({ id, role, name: 'check', email: 'check@example.test' }, SECRET as string, { expiresIn: '5m' });
}

function post(auth: string | null, body: unknown = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (auth) headers.set('authorization', `Bearer ${auth}`);
  return new NextRequest('http://localhost/api/opportunities', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

(async () => {
  console.log('opportunity create — authorization');

  await check('anonymous is rejected with 401', async () => {
    const res = await POST(post(null));
    assert.strictEqual(res.status, 401, `expected 401, got ${res.status}`);
  });

  await check('FACULTY is rejected with 403', async () => {
    // The regression this exists for: FACULTY used to be allowed to create.
    const res = await POST(post(tokenFor('FACULTY', 2)));
    assert.strictEqual(res.status, 403, `expected 403 for FACULTY, got ${res.status}`);
  });

  await check('STUDENT is rejected with 403', async () => {
    const res = await POST(post(tokenFor('STUDENT', 3)));
    assert.strictEqual(res.status, 403, `expected 403 for STUDENT, got ${res.status}`);
  });

  await check('a forged token is rejected with 401', async () => {
    const forged = jwt.sign({ id: 1, role: 'ADMIN', name: 'x', email: 'x@y.z' }, 'wrong-secret', { expiresIn: '5m' });
    const res = await POST(post(forged));
    assert.strictEqual(res.status, 401, `expected 401 for a bad signature, got ${res.status}`);
  });

  await check('ADMIN passes the guard (stops at validation, writes nothing)', async () => {
    const res = await POST(post(tokenFor('ADMIN', 1), {}));
    assert.strictEqual(res.status, 400, `expected 400 from body validation, got ${res.status}`);
    const body = (await res.json()) as { success: boolean };
    assert.strictEqual(body.success, false);
  });

  console.log(`\nALL CHECKS PASSED (${passed})`);
})().catch((err) => {
  console.error('\nCHECK FAILED:', err);
  process.exitCode = 1;
});
