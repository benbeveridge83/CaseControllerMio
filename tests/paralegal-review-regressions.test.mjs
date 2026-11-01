import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeedToSetController } from '../src/paralegal/need-to-set-controller.mjs';

const START = Date.parse('2026-09-18T15:00:00Z');
const TASK = { id: 'task-1', matterId: 'matter-1', revision: 'r1', matterName: 'Sample matter' };
const EMAIL = { to: ['counsel@example.test'], subject: 'Available dates', body: 'Please provide available dates.' };
const command = () => ({ taskId: TASK.id, action: 'draft_follow_up' });
function fixture(overrides = {}) {
  const records = new Map();
  const controller = createNeedToSetController({
    getSession: async () => ({ ownerId: 'owner-a', ready: true }),
    readTasks: async () => [TASK],
    composeEmail: async () => EMAIL,
    now: () => START,
    reviews: {
      save: async (_owner, record) => records.set(record.id, structuredClone(record)),
      load: async (_owner, id) => structuredClone(records.get(id)),
    },
    ...overrides,
  });
  return { controller, records };
}

test('accepts unchanged tasks after persistent storage reorders object keys', async () => {
  const { controller, records } = fixture();
  const result = await controller.prepare(command());
  const record = records.get(result.id);
  record.task = Object.fromEntries(Object.entries(record.task).reverse());
  assert.deepEqual((await controller.review(result.id)).email, EMAIL);
});

test('does not return an already expired review after a slow save', async () => {
  let time = START;
  const { controller } = fixture({
    now: () => time,
    reviews: { save: async () => { time += 15 * 60 * 1000; }, load: async () => undefined },
  });
  await assert.rejects(controller.prepare(command()), error => error.code === 'REVIEW_EXPIRED');
});

test('captures the validated command before asynchronous adapters run', async () => {
  const input = command();
  const { controller } = fixture({ composeEmail: async () => { input.action = 'send_email'; return EMAIL; } });
  assert.equal((await controller.prepare(input)).action, 'draft_follow_up');
});
