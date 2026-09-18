/**
 * Provider-neutral, server-side Need to Set tool boundary.
 * This module has no sender, calendar writer, filing tool, or workflow mutator.
 * Adapters are responsible for verified authentication, authorization, fresh
 * reads, side-effect-free email composition, and durable account-scoped storage.
 */
import { randomUUID } from 'node:crypto';

const ACTIONS = ['draft_date_request', 'draft_follow_up', 'draft_client_update'];
const REVIEW_TTL_MS = 15 * 60 * 1000;
const DESCRIPTION_FIELDS = ['matterName', 'status', 'step', 'waitingOn', 'nextAction', 'updatedAt'];
const idSchema = { type: 'string', minLength: 1, maxLength: 200 };
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

function freezeDeep(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child);
  }
  return Object.freeze(value);
}

export const PARALEGAL_TOOLS = freezeDeep([
  {
    name: 'need_to_set_list',
    description: 'Read the saved Need to Set status. Does not change any task.',
    parameters: objectSchema({}),
  },
  {
    name: 'need_to_set_detail',
    description: 'Read one task by an exact ID returned by need_to_set_list.',
    parameters: objectSchema({ taskId: idSchema }, ['taskId']),
  },
  {
    name: 'need_to_set_prepare_email',
    description: 'Prepare an email draft for review. NEVER sends or approves it.',
    parameters: objectSchema({ taskId: idSchema, action: { type: 'string', enum: ACTIONS },
      instruction: { type: 'string', maxLength: 4000 } }, ['taskId', 'action']),
  },
]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
function text(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function shape(value, allowed, required = [], code = 'INVALID_ARGUMENT') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) {
    fail(code, 'Invalid or unsupported fields.');
  }
}
function normalizeTasks(rows) {
  if (!Array.isArray(rows) || rows.length > 2000) {
    fail('INVALID_SNAPSHOT', 'Expected a bounded task snapshot.');
  }
  const ids = new Set();
  return rows.map(row => {
    if (!row || !text(row.id) || !text(row.matterId) || !text(row.revision) || ids.has(row.id)) {
      fail('INVALID_SNAPSHOT', 'Unique task IDs, matter IDs, and record revisions are required.');
    }
    ids.add(row.id);
    const task = { id: row.id, matterId: row.matterId, revision: row.revision };
    for (const key of DESCRIPTION_FIELDS) {
      if (row[key] != null && (typeof row[key] !== 'string' || row[key].length > 2000)) {
        fail('INVALID_SNAPSHOT', 'Task descriptions must be bounded strings.');
      }
      task[key] = row[key] ?? '';
    }
    return task;
  });
}
function normalizeEmail(draft) {
  shape(draft, ['to', 'subject', 'body'], ['to', 'subject', 'body'], 'INVALID_DRAFT');
  if (!Array.isArray(draft.to) || draft.to.length < 1 || draft.to.length > 20
    || draft.to.some(address => typeof address !== 'string' || address.length > 254
      || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address))
    || !text(draft.subject, 250) || /[\r\n]/.test(draft.subject)
    || !text(draft.body, 20000)) {
    fail('INVALID_DRAFT', 'A draft needs valid recipients and an exact subject and body.');
  }
  return { to: [...draft.to], subject: draft.subject, body: draft.body };
}
function publicReview(record) {
  return {
    id: record.id, state: 'needs_review', executionEnabled: false, source: 'need-to-set',
    taskId: record.taskId, matterName: record.task.matterName, action: record.action,
    email: structuredClone(record.email), createdAt: record.createdAt, expiresAt: record.expiresAt,
  };
}
// JSON-backed stores may reorder keys. Compare normalized field values, not serialization.
const sameTask = (left, right) => Boolean(left && right
  && ['id', 'matterId', 'revision', ...DESCRIPTION_FIELDS].every(key => left[key] === right[key]));

export function createNeedToSetController({ getSession, readTasks, composeEmail, reviews, now = Date.now } = {}) {
  if (typeof getSession !== 'function' || typeof readTasks !== 'function' || typeof now !== 'function') {
    fail('INVALID_CONFIG', 'Authenticated session and authorized task adapters are required.');
  }
  async function owner() {
    const session = await getSession();
    if (!session || !text(session.ownerId)) fail('NOT_AUTHENTICATED', 'Sign in to an authorized Mio account.');
    if (session.ready !== true) fail('NOT_READY', 'Cloud data is not ready; there is no local fallback.');
    return session.ownerId;
  }
  async function checkOwner(expected) {
    if (expected !== await owner()) fail('SCOPE_CHANGED', 'The account changed; start again.');
  }
  async function snapshot(account) {
    const tasks = normalizeTasks(await readTasks(account));
    await checkOwner(account);
    return tasks;
  }
  async function task(account, id) {
    if (!text(id)) fail('INVALID_ARGUMENT', 'Use an exact task ID.');
    const result = (await snapshot(account)).find(row => row.id === id);
    if (!result) fail('TASK_NOT_FOUND', 'Task not found in the authorized Need to Set snapshot.');
    return result;
  }
  function requireReviews() {
    if (!reviews || typeof reviews.save !== 'function' || typeof reviews.load !== 'function') {
      fail('REVIEWS_UNAVAILABLE', 'Durable account-scoped review storage is not configured.');
    }
  }
  function checkExpiry(record) {
    const expiry = Date.parse(record.expiresAt);
    if (!Number.isFinite(expiry) || now() >= expiry) {
      fail('REVIEW_EXPIRED', 'Review expired; prepare a fresh draft.');
    }
  }
  async function list() {
    const account = await owner();
    return { source: 'need-to-set', tasks: await snapshot(account), observedAt: new Date(now()).toISOString() };
  }
  async function detail(id) {
    const account = await owner();
    return { source: 'need-to-set', task: await task(account, id), observedAt: new Date(now()).toISOString() };
  }
  async function prepare(input) {
    shape(input, ['taskId', 'action', 'instruction'], ['taskId', 'action']);
    if (!ACTIONS.includes(input.action) || (input.instruction !== undefined
      && (typeof input.instruction !== 'string' || input.instruction.length > 4000))) {
      fail('INVALID_ARGUMENT', 'Only supported email-draft actions are available.');
    }
    const command = { ...input };
    const account = await owner();
    requireReviews();
    if (typeof composeEmail !== 'function') fail('DRAFTS_UNAVAILABLE', 'Email preparation is not configured.');
    const before = await task(account, command.taskId);
    const email = normalizeEmail(await composeEmail(account, structuredClone(before), { ...command }));
    await checkOwner(account);
    const after = await task(account, command.taskId);
    if (!sameTask(before, after)) fail('STALE_REVIEW', 'Task changed while the draft was being prepared.');
    const time = now();
    const record = {
      id: randomUUID(), ownerId: account, taskId: before.id, task: before, action: command.action, email,
      createdAt: new Date(time).toISOString(), expiresAt: new Date(time + REVIEW_TTL_MS).toISOString(),
    };
    // A rejected save must never produce a successful review card.
    await reviews.save(account, structuredClone(record));
    await checkOwner(account);
    checkExpiry(record);
    return publicReview(record);
  }
  async function review(id) {
    if (!text(id)) fail('INVALID_ARGUMENT', 'A review ID is required.');
    const account = await owner();
    requireReviews();
    const saved = await reviews.load(account, id);
    await checkOwner(account);
    if (!saved || saved.ownerId !== account || saved.id !== id) {
      fail('REVIEW_NOT_FOUND', 'Review not found in this account.');
    }
    const record = structuredClone(saved);
    checkExpiry(record);
    const current = await task(account, record.taskId);
    if (!sameTask(current, record.task)) fail('STALE_REVIEW', 'Task changed; prepare a fresh draft.');
    checkExpiry(record);
    return publicReview({ ...record, email: normalizeEmail(record.email) });
  }
  async function call(name, args = {}) {
    if (name === 'need_to_set_list') { shape(args, []); return list(); }
    if (name === 'need_to_set_detail') { shape(args, ['taskId'], ['taskId']); return detail(args.taskId); }
    if (name === 'need_to_set_prepare_email') return prepare(args);
    fail('UNKNOWN_TOOL', 'This assistant cannot execute that tool.');
  }
  return Object.freeze({ list, detail, prepare, review, call });
}
