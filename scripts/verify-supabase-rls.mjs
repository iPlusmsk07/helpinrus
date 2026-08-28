import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const users = [];
const checks = [];

function record(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function request(path, {
  method = 'GET',
  body,
  token = anonKey,
  apiKey = anonKey,
  prefer,
} = {}) {
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${token}`,
  };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { response, data };
}

async function expectOk(name, operation) {
  const result = await operation;
  assert.ok(
    result.response.ok,
    `${name}: HTTP ${result.response.status} ${JSON.stringify(result.data)}`,
  );
  record(name);
  return result.data;
}

async function expectDenied(name, operation) {
  const result = await operation;
  assert.ok(
    !result.response.ok,
    `${name}: request unexpectedly succeeded with ${JSON.stringify(result.data)}`,
  );
  record(name);
}

async function createUser(label, suffix) {
  const password = `${randomBytes(18).toString('base64url')}Aa1!`;
  const email = `pomogay-rls-${suffix}-${label}@example.com`;
  const data = await expectOk(
    `admin creates user ${label}`,
    request('/auth/v1/admin/users', {
      method: 'POST',
      apiKey: serviceRoleKey,
      token: serviceRoleKey,
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { name: `RLS ${label.toUpperCase()}`, city: 'Moscow' },
      },
    }),
  );

  const user = { label, id: data.id, email, password };
  users.push(user);
  return user;
}

async function signIn(user) {
  const data = await expectOk(
    `user ${user.label} signs in`,
    request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: user.email, password: user.password },
    }),
  );
  assert.ok(data.access_token, `user ${user.label}: no access token returned`);
  user.token = data.access_token;
}

async function rest(user, table, {
  method = 'GET',
  query = 'select=*',
  body,
  prefer,
} = {}) {
  return request(`/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    body,
    token: user?.token ?? anonKey,
    prefer,
  });
}

async function cleanup() {
  let failures = 0;

  for (const user of users.reverse()) {
    try {
      const result = await request(`/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        apiKey: serviceRoleKey,
        token: serviceRoleKey,
      });
      if (!result.response.ok) {
        console.error(`CLEANUP FAILED user ${user.label}: HTTP ${result.response.status}`);
        failures += 1;
      }
    } catch (error) {
      console.error(`CLEANUP FAILED user ${user.label}: ${error.message}`);
      failures += 1;
    }
  }

  if (failures > 0) process.exitCode = 1;
}

const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;

try {
  const a = await createUser('a', suffix);
  const b = await createUser('b', suffix);
  const c = await createUser('c', suffix);
  await Promise.all([signIn(a), signIn(b), signIn(c)]);

  const profiles = await expectOk(
    'signup trigger creates constrained profiles',
    rest(a, 'profiles', {
      query: `id=in.(${a.id},${b.id},${c.id})&select=id,role,verified,rating`,
    }),
  );
  assert.equal(profiles.length, 3);
  assert.ok(profiles.every((profile) => profile.role === 'customer'));
  assert.ok(profiles.every((profile) => profile.verified === false));

  const ownProfile = await expectOk(
    'user can update own ordinary profile fields',
    rest(a, 'profiles', {
      method: 'PATCH',
      query: `id=eq.${a.id}&select=id,name,city`,
      body: { name: 'RLS Alice', city: 'Kazan' },
      prefer: 'return=representation',
    }),
  );
  assert.equal(ownProfile.length, 1);

  await expectDenied(
    'user cannot grant own admin or trusted status',
    rest(a, 'profiles', {
      method: 'PATCH',
      query: `id=eq.${a.id}`,
      body: {
        role: 'admin',
        verified: true,
        rating: 5,
        legal_status: 'company',
        pro_until: '2099-01-01T00:00:00Z',
      },
    }),
  );

  const foreignProfile = await expectOk(
    'user cannot update another profile',
    rest(b, 'profiles', {
      method: 'PATCH',
      query: `id=eq.${a.id}&select=id,name`,
      body: { name: 'Taken over' },
      prefer: 'return=representation',
    }),
  );
  assert.deepEqual(foreignProfile, []);

  const [service] = await expectOk(
    'owner can create a service',
    rest(a, 'services', {
      method: 'POST',
      query: 'select=id,owner_id,title',
      body: {
        owner_id: a.id,
        title: 'Secure test service',
        category: 'test',
        description: 'A service created by the automated RLS verification.',
        price_from: 100,
        city: 'Kazan',
        is_active: true,
      },
      prefer: 'return=representation',
    }),
  );
  assert.equal(service.owner_id, a.id);

  await expectDenied(
    'user cannot create a service for another owner',
    rest(a, 'services', {
      method: 'POST',
      body: {
        owner_id: b.id,
        title: 'Spoofed service',
        category: 'test',
        description: 'This service must be rejected by the owner policy.',
      },
    }),
  );

  const foreignService = await expectOk(
    'user cannot update another owner service',
    rest(b, 'services', {
      method: 'PATCH',
      query: `id=eq.${service.id}&select=id,title`,
      body: { title: 'Taken over service' },
      prefer: 'return=representation',
    }),
  );
  assert.deepEqual(foreignService, []);

  const [task] = await expectOk(
    'customer can create an open task',
    rest(a, 'tasks', {
      method: 'POST',
      query: 'select=id,customer_id,status',
      body: {
        customer_id: a.id,
        title: 'Secure test task',
        category: 'test',
        description: 'A task created by the automated RLS verification.',
        budget: 250,
        status: 'open',
      },
      prefer: 'return=representation',
    }),
  );
  assert.equal(task.status, 'open');

  const [response] = await expectOk(
    'helper can respond and status defaults to pending',
    rest(b, 'responses', {
      method: 'POST',
      query: 'select=id,task_id,helper_id,status',
      body: {
        task_id: task.id,
        helper_id: b.id,
        price: 200,
        message: 'I can help with this secure test task.',
      },
      prefer: 'return=representation',
    }),
  );
  assert.equal(response.status, 'pending');

  await expectDenied(
    'helper cannot choose response status on insert',
    rest(c, 'responses', {
      method: 'POST',
      body: {
        task_id: task.id,
        helper_id: c.id,
        price: 210,
        message: 'This response tries to bypass the pending state.',
        status: 'accepted',
      },
    }),
  );

  const outsiderResponses = await expectOk(
    'outsider cannot read a response',
    rest(c, 'responses', { query: `id=eq.${response.id}&select=*` }),
  );
  assert.deepEqual(outsiderResponses, []);

  const customerResponses = await expectOk(
    'task customer can read a response',
    rest(a, 'responses', { query: `id=eq.${response.id}&select=id,status` }),
  );
  assert.equal(customerResponses.length, 1);

  const helperResponses = await expectOk(
    'response helper can read own response',
    rest(b, 'responses', { query: `id=eq.${response.id}&select=id,status` }),
  );
  assert.equal(helperResponses.length, 1);

  const helperStatusChange = await expectOk(
    'helper cannot accept own response',
    rest(b, 'responses', {
      method: 'PATCH',
      query: `id=eq.${response.id}&select=id,status`,
      body: { status: 'accepted' },
      prefer: 'return=representation',
    }),
  );
  assert.deepEqual(helperStatusChange, []);

  const accepted = await expectOk(
    'task customer can accept a response',
    rest(a, 'responses', {
      method: 'PATCH',
      query: `id=eq.${response.id}&select=id,status`,
      body: { status: 'accepted' },
      prefer: 'return=representation',
    }),
  );
  assert.equal(accepted[0].status, 'accepted');

  const [conversation] = await expectOk(
    'accepted participants can create a conversation',
    rest(b, 'conversations', {
      method: 'POST',
      query: 'select=id,task_id,customer_id,helper_id',
      body: { task_id: task.id, customer_id: a.id, helper_id: b.id },
      prefer: 'return=representation',
    }),
  );

  const outsiderConversations = await expectOk(
    'outsider cannot read a conversation',
    rest(c, 'conversations', { query: `id=eq.${conversation.id}&select=*` }),
  );
  assert.deepEqual(outsiderConversations, []);

  const [message] = await expectOk(
    'participant can send a message as self',
    rest(b, 'messages', {
      method: 'POST',
      query: 'select=id,conversation_id,sender_id,read_at',
      body: {
        conversation_id: conversation.id,
        sender_id: b.id,
        body: 'A private message used by the RLS verification.',
      },
      prefer: 'return=representation',
    }),
  );

  const outsiderMessages = await expectOk(
    'outsider cannot read a private message',
    rest(c, 'messages', { query: `id=eq.${message.id}&select=*` }),
  );
  assert.deepEqual(outsiderMessages, []);

  const senderRead = await expectOk(
    'sender cannot mark own message as read',
    rest(b, 'messages', {
      method: 'PATCH',
      query: `id=eq.${message.id}&select=id,read_at`,
      body: { read_at: new Date().toISOString() },
      prefer: 'return=representation',
    }),
  );
  assert.deepEqual(senderRead, []);

  const recipientRead = await expectOk(
    'recipient can mark message as read',
    rest(a, 'messages', {
      method: 'PATCH',
      query: `id=eq.${message.id}&select=id,read_at`,
      body: { read_at: new Date().toISOString() },
      prefer: 'return=representation',
    }),
  );
  assert.ok(recipientRead[0].read_at);

  await expectOk(
    'user can add own favorite',
    rest(a, 'favorites', {
      method: 'POST',
      body: { user_id: a.id, service_id: service.id },
      prefer: 'return=minimal',
    }),
  );

  await expectDenied(
    'user cannot add a favorite for another user',
    rest(b, 'favorites', {
      method: 'POST',
      body: { user_id: a.id, service_id: service.id },
    }),
  );

  await expectOk(
    'user can submit a report only as self',
    rest(b, 'reports', {
      method: 'POST',
      body: {
        reporter_id: b.id,
        target_user_id: a.id,
        reason: 'Security test',
        details: 'This temporary report is removed during cleanup.',
      },
      prefer: 'return=minimal',
    }),
  );

  await expectDenied(
    'ordinary users cannot list reports',
    rest(c, 'reports', { query: 'select=*' }),
  );

  const publicProfiles = await expectOk(
    'anonymous visitor can read public profile data',
    rest(null, 'profiles', { query: `id=eq.${a.id}&select=id,name,city` }),
  );
  assert.equal(publicProfiles.length, 1);

  const publicServices = await expectOk(
    'anonymous visitor can read active services',
    rest(null, 'services', { query: `id=eq.${service.id}&select=id,title` }),
  );
  assert.equal(publicServices.length, 1);

  const publicTasks = await expectOk(
    'anonymous visitor can read open tasks',
    rest(null, 'tasks', { query: `id=eq.${task.id}&select=id,title,status` }),
  );
  assert.equal(publicTasks.length, 1);

  await expectDenied(
    'anonymous visitor cannot create a task',
    rest(null, 'tasks', {
      method: 'POST',
      body: {
        customer_id: a.id,
        title: 'Anonymous task',
        category: 'test',
        description: 'This anonymous write must be rejected by database grants.',
      },
    }),
  );

  console.log(`\nRLS integration verification passed: ${checks.length} checks.`);
} catch (error) {
  console.error(`\nRLS integration verification failed after ${checks.length} checks.`);
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await cleanup();
}
