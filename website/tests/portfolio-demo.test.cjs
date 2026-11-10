const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const origin = new URL(process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:3000');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Tests are restricted to a local demo server.');
async function request(route, method = 'GET', body) {
  return fetch(new URL(route, origin), { method, redirect: 'manual', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test('workspace pages render and account pages do not collect credentials', async () => {
  for (const route of ['/', '/dashboard', '/dashboard/saved/demo-linux-access-review', '/dashboard/tutor', '/dashboard/labs']) {
    const response = await request(route); assert.equal(response.status, 200, route);
    assert.match(await response.text(), /Local portfolio demo/);
  }
  for (const route of ['/login', '/signup', '/reset-password', '/admin']) {
    const response = await request(route); assert.equal(response.status, 307, route); assert.equal(new URL(response.headers.get('location'), origin).pathname, '/dashboard');
  }
});

test('unknown and operational APIs never fall through to live handlers', async () => {
  for (const route of ['/api/unknown', '/api/admin/users/delete', '/api/web-labs/runtime/launch', '/api/web-labs/local-runner/demo/package']) {
    const response = await request(route, 'POST', { operation: 'LAUNCH', userId: 'synthetic' });
    assert.equal(response.status, 409, route); assert.equal(response.headers.get('x-amniora-mode'), 'synthetic-local-demo');
  }
});

test('local boundary rejects foreign hosts, cross-site origins and mutation reads', async () => {
  for (const headers of [{ Host: 'not-local.example.test' }, { Origin: 'https://not-local.example.test' }]) {
    const status = await new Promise((resolve, reject) => {
      const req = http.get(new URL('/api/ai/conversations', origin), { headers }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject);
    });
    assert.equal(status, 403);
  }
  const sameOrigin = await fetch(new URL('/api/ai/conversations', origin), { headers: { Origin: origin.origin } });
  assert.equal(sameOrigin.status, 200);
  for (const route of ['/api/portfolio/reset', '/api/ai/conversations/delete-all']) assert.equal((await request(route)).status, 405);
  for (const body of ['null', '[]']) {
    const response = await fetch(new URL('/api/ai/tutor', origin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
  }
});

test('generation and Tutor return explicit deterministic examples', async () => {
  const generation = await request('/api/ai/lab-generation-jobs', 'POST', { category: 'Linux', difficulty: 'Beginner', duration: '30 mins' });
  const job = await generation.json(); assert.equal(job.job.status, 'completed'); assert.equal(job.job.resultingLabId, 'demo-linux-access-review'); assert.equal(job.demo, true);
  const created = await (await request('/api/ai/conversations', 'POST', {})).json();
  const reply = await (await request('/api/ai/tutor', 'POST', { conversationId: created.conversation.id, message: 'Explain Linux permissions' })).json();
  assert.equal(reply.demo, true); assert.match(reply.message, /Example response from the local demo/);
  const history = await (await request(`/api/ai/conversations/${created.conversation.id}`)).json(); assert.equal(history.messages.length, 2);
});

test('the existing export builders produce synthetic PDF and ZIP downloads', async () => {
  const pdf = await request('/api/labs/demo-linux-access-review/download?format=pdf');
  assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const zip = await request('/api/labs/demo-linux-access-review/download');
  assert.equal(zip.headers.get('content-type'), 'application/zip'); assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt16LE(0), 0x4b50);
});

test('network guard rejects outbound fetch and sockets before a connection', () => {
  const guard = path.join(root, 'scripts/portfolio-network-guard.cjs');
  const code = "const assert=require('node:assert/strict');const net=require('node:net');assert.throws(()=>fetch('https://example.test'),/External networking/);assert.throws(()=>net.connect({host:'example.test',port:443}),/External networking/);assert.throws(()=>net.connect({host:'127.0.0.1',port:443,lookup:()=>{}}),/External networking/);assert.throws(()=>net.connect({path:'remote-pipe'}),/External networking/);assert.throws(()=>net.connect('remote-pipe'),/External networking/);";
  const result = spawnSync(process.execPath, ['--require', guard, '-e', code], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('launcher refuses environment files and drops inherited service variables', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'amniora-launcher-test-'));
  try {
    fs.mkdirSync(path.join(temporary, 'scripts'));
    for (const name of ['portfolio-next.cjs', 'portfolio-network-guard.cjs']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(temporary, 'scripts', name));
    const binary = path.join(temporary, 'node_modules/next/dist/bin'); fs.mkdirSync(binary, { recursive: true });
    fs.writeFileSync(path.join(binary, 'next.js'), "if(process.env.OPENAI_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_URL)process.exit(7);if(process.env.NEXT_TELEMETRY_DISABLED!=='1')process.exit(8);console.log('CLEAN_LOCAL_ENV');");
    const launcher = path.join(temporary, 'scripts/portfolio-next.cjs');
    const env = { ...process.env, OPENAI_API_KEY: 'synthetic-sentinel', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-sentinel', NEXT_PUBLIC_SUPABASE_URL: 'https://example.test' };
    const clean = spawnSync(process.execPath, [launcher, 'dev'], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(clean.status, 0, clean.stderr); assert.match(clean.stdout, /CLEAN_LOCAL_ENV/);
    fs.writeFileSync(path.join(temporary, '.env.local'), '# Empty synthetic refusal fixture.\n');
    const blocked = spawnSync(process.execPath, [launcher, 'dev'], { env, encoding: 'utf8', windowsHide: true });
    assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /does not load environment files/);
  } finally {
    const resolved = path.resolve(temporary); const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('amniora-launcher-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
