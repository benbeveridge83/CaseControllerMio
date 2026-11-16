import test from 'node:test';
import assert from 'node:assert/strict';

const moduleUrl = new URL('../src/paralegal/need-to-set-controller.mjs', import.meta.url);
const implementation = await import(moduleUrl).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const { createNeedToSetController, PARALEGAL_TOOLS } = implementation;
const START = Date.parse('2026-09-18T15:00:00Z');
const TASK = {
  id: 'task-1', matterId: 'matter-1', revision: 'r1', matterName: 'Sample matter',
  status: 'Waiting', step: 'Request dates', waitingOn: 'Opposing counsel',
  nextAction: 'Review a follow-up', updatedAt: '2026-09-17T15:00:00Z',
};
const EMAIL = { to: ['counsel@example.test'], subject: 'Available dates', body: 'Please provide available dates.' };

function fixture(overrides = {}) {
  assert.equal(typeof createNeedToSetController, 'function', 'controller implementation must exist');
  const state = { session: { ownerId: 'owner-a', ready: true }, tasks: [structuredClone(TASK)], time: START };
  const records = new Map();
  const adapters = {
    getSession: async () => state.session,
    readTasks: async () => structuredClone(state.tasks),
    composeEmail: async () => structuredClone(EMAIL),
    reviews: {
      save: async (owner, record) => records.set(`${owner}:${record.id}`, structuredClone(record)),
      load: async (owner, id) => structuredClone(records.get(`${owner}:${id}`)),
    },
    now: () => state.time,
    ...overrides,
  };
  return { controller: createNeedToSetController(adapters), state, records, adapters };
}
const prepare = controller => controller.call('need_to_set_prepare_email', { taskId: TASK.id, action: 'draft_follow_up' });
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('exports a controller with no send, execute, or approve operation', () => {
  const { controller } = fixture();
  assert.deepEqual(Object.keys(controller).sort(), ['call', 'detail', 'list', 'prepare', 'review']);
  assert.ok(Object.isFrozen(controller));
});

test('lists the current adapter snapshot rather than a cached result', async () => {
  const { controller, state } = fixture();
  assert.deepEqual((await controller.list()).tasks, [TASK]);
  state.tasks[0].waitingOn = 'Court coordinator';
  const result = await controller.list();
  assert.equal(result.tasks[0].waitingOn, 'Court coordinator');
  assert.equal(result.observedAt, new Date(START).toISOString());
});

test('omits unrelated private fields from the tool snapshot', async () => {
  const { controller, state } = fixture();
  state.tasks[0].privateToken = 'not-for-the-model';
  assert.equal(Object.hasOwn((await controller.list()).tasks[0], 'privateToken'), false);
});

test('reads a task only by exact ID, not a partial name', async () => {
  const { controller } = fixture();
  assert.deepEqual((await controller.call('need_to_set_detail', { taskId: TASK.id })).task, TASK);
  await rejectsCode(controller.detail('Sample'), 'TASK_NOT_FOUND');
});

test('reports an empty authorized snapshot without inventing tasks', async () => {
  const { controller, state } = fixture();
  state.tasks = [];
  assert.deepEqual((await controller.list()).tasks, []);
});

test('requires a signed-in account before exposing task information', async () => {
  const { controller, state } = fixture();
  state.session = null;
  await rejectsCode(controller.list(), 'NOT_AUTHENTICATED');
});

test('refuses reads while the cloud snapshot is not ready', async () => {
  const { controller, state } = fixture();
  state.session.ready = false;
  await rejectsCode(controller.list(), 'NOT_READY');
});

test('does not return data when the account changes during a read', async () => {
  let session = { ownerId: 'owner-a', ready: true };
  const { controller } = fixture({
    getSession: async () => session,
    readTasks: async () => { session = { ownerId: 'owner-b', ready: true }; return [TASK]; },
  });
  await rejectsCode(controller.list(), 'SCOPE_CHANGED');
});

test('rejects duplicate task IDs', async () => {
  const { controller, state } = fixture();
  state.tasks.push(structuredClone(TASK));
  await rejectsCode(controller.list(), 'INVALID_SNAPSHOT');
});

test('requires a record revision for stale-review protection', async () => {
  const { controller, state } = fixture();
  delete state.tasks[0].revision;
  await rejectsCode(controller.list(), 'INVALID_SNAPSHOT');
});

test('rejects unsupported tools and approval flags from a model', async () => {
  const { controller } = fixture();
  await rejectsCode(controller.call('send_email', {}), 'UNKNOWN_TOOL');
  await rejectsCode(controller.call('need_to_set_list', { ownerId: 'owner-b' }), 'INVALID_ARGUMENT');
  await rejectsCode(controller.call('need_to_set_prepare_email', { taskId: TASK.id, action: 'draft_follow_up', approved: true }), 'INVALID_ARGUMENT');
});

test('rejects inherited or non-object tool arguments', async () => {
  const { controller } = fixture();
  await rejectsCode(controller.call('need_to_set_list', []), 'INVALID_ARGUMENT');
  await rejectsCode(controller.call('need_to_set_detail', Object.create({ taskId: TASK.id })), 'INVALID_ARGUMENT');
});

test('rejects unsupported draft actions and oversized instructions', async () => {
  const { controller } = fixture();
  await rejectsCode(controller.prepare({ taskId: TASK.id, action: 'file_notice' }), 'INVALID_ARGUMENT');
  await rejectsCode(controller.prepare({ taskId: TASK.id, action: 'draft_follow_up', instruction: 'x'.repeat(4001) }), 'INVALID_ARGUMENT');
});

test('prepares an exact draft for review and does not change the source task', async () => {
  const { controller, state } = fixture();
  const result = await prepare(controller);
  assert.equal(result.state, 'needs_review');
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.email, EMAIL);
  assert.deepEqual(state.tasks, [TASK]);
  assert.equal(Date.parse(result.expiresAt) - START, 15 * 60 * 1000);
  assert.deepEqual(await controller.review(result.id), result);
});

test('does not expose account identifiers or private record revisions in a review card', async () => {
  const { controller } = fixture();
  const result = await prepare(controller);
  assert.equal(Object.hasOwn(result, 'ownerId'), false);
  assert.equal(Object.hasOwn(result, 'task'), false);
});

test('requires persistent review storage instead of silently using memory', async () => {
  const { controller } = fixture({ reviews: undefined });
  await rejectsCode(prepare(controller), 'REVIEWS_UNAVAILABLE');
});

test('does not claim a draft is saved after persistence fails', async () => {
  const { controller } = fixture({ reviews: { save: async () => { throw new Error('storage unavailable'); }, load: async () => undefined } });
  await assert.rejects(prepare(controller), /storage unavailable/);
});

test('rejects hidden recipients and unsupported email fields', async () => {
  const { controller } = fixture({ composeEmail: async () => ({ ...EMAIL, bcc: ['hidden@example.test'] }) });
  await rejectsCode(prepare(controller), 'INVALID_DRAFT');
});

test('rejects header injection and malformed recipients', async () => {
  for (const email of [{ ...EMAIL, subject: 'Subject\r\nBcc: hidden@example.test' }, { ...EMAIL, to: ['not-an-address'] }]) {
    const { controller } = fixture({ composeEmail: async () => email });
    await rejectsCode(prepare(controller), 'INVALID_DRAFT');
  }
});

test('rejects changed tasks before persisting a prepared review', async () => {
  const tasks = [structuredClone(TASK)];
  const { controller, records } = fixture({
    readTasks: async () => tasks,
    composeEmail: async () => { tasks[0].revision = 'r2'; return EMAIL; },
  });
  await rejectsCode(prepare(controller), 'STALE_REVIEW');
  assert.equal(records.size, 0);
});

test('rejects an account switch during email preparation', async () => {
  let session = { ownerId: 'owner-a', ready: true };
  const { controller, records } = fixture({
    getSession: async () => session,
    composeEmail: async () => { session = { ownerId: 'owner-b', ready: true }; return EMAIL; },
  });
  await rejectsCode(prepare(controller), 'SCOPE_CHANGED');
  assert.equal(records.size, 0);
});

test('rechecks the session after review persistence', async () => {
  let session = { ownerId: 'owner-a', ready: true };
  const { controller } = fixture({
    getSession: async () => session,
    reviews: { save: async () => { session = { ownerId: 'owner-b', ready: true }; }, load: async () => undefined },
  });
  await rejectsCode(prepare(controller), 'SCOPE_CHANGED');
});

test('does not expose a review belonging to another account even if storage returns it', async () => {
  const { controller, adapters, state, records } = fixture();
  const result = await prepare(controller);
  const record = records.get(`owner-a:${result.id}`);
  adapters.reviews.load = async () => record;
  state.session.ownerId = 'owner-b';
  await rejectsCode(controller.review(result.id), 'REVIEW_NOT_FOUND');
});

test('expires reviews at the exact expiry boundary', async () => {
  const { controller, state } = fixture();
  const result = await prepare(controller);
  state.time = Date.parse(result.expiresAt);
  await rejectsCode(controller.review(result.id), 'REVIEW_EXPIRED');
});

test('rechecks expiration after a slow task refresh', async () => {
  let time = START;
  let slow = false;
  const { controller } = fixture({ now: () => time, readTasks: async () => { if (slow) time += 15 * 60 * 1000; return [TASK]; } });
  const result = await prepare(controller);
  slow = true;
  await rejectsCode(controller.review(result.id), 'REVIEW_EXPIRED');
});

test('rejects stale reviews even when an adapter forgets to change the revision', async () => {
  const { controller, state } = fixture();
  const result = await prepare(controller);
  state.tasks[0].waitingOn = 'Someone else';
  await rejectsCode(controller.review(result.id), 'STALE_REVIEW');
});

test('returned review edits do not change the persisted draft', async () => {
  const { controller } = fixture();
  const result = await prepare(controller);
  result.email.to[0] = 'different@example.test';
  result.email.body = 'Changed in caller';
  assert.deepEqual((await controller.review(result.id)).email, EMAIL);
});

test('publishes immutable schemas for only the three supported tools', () => {
  assert.deepEqual(PARALEGAL_TOOLS.map(tool => tool.name), ['need_to_set_list', 'need_to_set_detail', 'need_to_set_prepare_email']);
  assert.equal(PARALEGAL_TOOLS.every(tool => tool.parameters.additionalProperties === false), true);
  assert.throws(() => { PARALEGAL_TOOLS[2].parameters.properties.action.enum.push('send'); }, TypeError);
});
