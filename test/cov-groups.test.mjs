// Groups and task boards: groups from agents, save/delete, tasks, goal planning (lead's plan or the fallback chain),
// the worker loop running tasks through the agent (mock model), review → approve/reject, roll-up, cancel,
// restart recovery, and routines.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_PROVIDER = 'mock'; process.env.AI_MOCK = 'on';
const G = await import('../lib/groups.js');

const memStore = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v) => { m.set(k, v); }, all: async () => [...m].map(([k, v]) => ({ k, v })) }; };
const secret = async () => 'groups-secret';
const data = { agents: [{ id: 1, name: 'Scout', d: 'Researches', group: 'Factory' }, { id: 2, name: 'Spec Writer', d: 'Writes briefs', group: 'Factory' }, { id: 3, name: 'Desk', d: 'Front desk', group: 'Desk' }, null] };
const board = (st, email) => JSON.parse(st.m.get('as_board:' + email) || '[]');
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('groups are built from agents, edited and deleted', async () => {
  const st = memStore(), email = 'g@example.com';
  const groups = await G.getGroups(st, email, data);
  assert.deepEqual(groups.map((g) => g.name).sort(), ['Desk', 'Factory']);
  assert.deepEqual(await G.getGroups(st, email, { agents: [] }), groups, 'stored once, then read back');
  const f = G.findGroup(groups, 'factory'); assert.equal(f.lead, 1);
  const n = await G.saveGroup(st, email, data, { name: 'Growth', desc: 'Marketing', members: [3, 99], lead: 2, limit: 5, over: [f.id, 'nope'] });
  assert.deepEqual(n.members, [2, 3]); assert.equal(n.limit, 2); assert.deepEqual(n.over, [f.id]);
  await assert.rejects(G.saveGroup(st, email, data, { name: '  ' }), /needs a name/);
  const e = await G.saveGroup(st, email, data, { id: n.id, name: '', lead: 99, limit: 0 });
  assert.equal(e.name, 'Growth'); assert.equal(e.limit, 1);
  const t = await G.addTask(st, email, { gid: n.id, title: 'Plan Diwali', body: 'x', status: 'review' });
  await G.deleteGroup(st, email, n.id);
  assert.equal(G.findGroup(await G.getGroups(st, email, data), n.id), undefined);
  assert.equal(board(st, email).find((x) => x.id === t.id).status, 'blocked');
});

test('tasks: add, update, delete', async () => {
  const st = memStore(), email = 't@example.com';
  const t = await G.addTask(st, email, { gid: 'g1', title: 'A', body: 'B', aid: '2', status: 'weird', send: { url: 'u' } });
  assert.equal(t.status, 'todo'); assert.equal(t.aid, 2); assert.ok(t.send);
  const u = await G.updateTask(st, email, t.id, { title: 'A2', body: 'B2', aid: null, status: 'blocked' });
  assert.equal(u.title, 'A2'); assert.equal(u.aid, null); assert.equal(u.status, 'blocked');
  assert.equal((await G.updateTask(st, email, t.id, { status: 'todo' })).err, '');
  assert.equal((await G.updateTask(st, email, t.id, { status: 'running' })).status, 'todo', 'running is only set by the worker');
  await assert.rejects(G.updateTask(st, email, 'nope', {}), /No such task/);
  await G.deleteTask(st, email, t.id); assert.equal(board(st, email).length, 0);
});

test('goal planning: the lead\'s JSON plan, and the fallback chain when the plan is unusable', async () => {
  const st = memStore(), email = 'p@example.com', groups = await G.getGroups(st, email, data), f = G.findGroup(groups, 'Factory');
  const ai = async () => ({ text: 'Plan:\n{"tasks":[{"title":"Research rivals","body":"find 5","assignee_id":1,"research":true},{"title":"Write brief","body":"one page","assignee_id":2,"after":0,"gate":true},{"title":"Extra","assignee_id":77,"after":9}]}' });
  const r = await G.planGoal({ st, email, data, groups, gid: f.id, goal: 'Launch a dental chatbot', ai });
  assert.equal(r.lead, 'Scout'); assert.equal(r.tasks.length, 3);
  assert.equal(r.tasks[1].after, r.tasks[0].id); assert.equal(r.tasks[1].gate, true); assert.equal(r.tasks[2].aid, 1, 'unknown assignee → lead');
  const r2 = await G.planGoal({ st, email, data, groups, gid: 'Factory', goal: 'Something', ai: async () => { throw new Error('model down'); } });
  assert.equal(r2.tasks.length, 2); assert.equal(r2.tasks[1].aid, 2, 'write-up goes to the writer');
  await assert.rejects(G.planGoal({ st, email, data, groups, gid: 'nope', goal: 'x', ai }), /No such group/);
  const empty = [{ id: 'gx', name: 'Empty', members: [], lead: null }];
  await assert.rejects(G.planGoal({ st, email, data, groups: empty, gid: 'gx', goal: 'x', ai }), /no agents/);
});

test('worker runs tasks in order, review → approve/reject, goals roll up, send tasks, cancel', async () => {
  const st = memStore(), email = 'w@example.com';
  st.m.set('as_data:' + email, JSON.stringify(data));
  const groups = await G.getGroups(st, email, data), f = G.findGroup(groups, 'Factory');
  const events = []; const off = G.onBoardEvent((e) => events.push(e.kind));
  const { parent, tasks } = await G.planGoal({ st, email, data, groups, gid: f.id, goal: 'Find 3 clinics', ai: async () => ({ text: '{"tasks":[{"title":"Find","body":"find","assignee_id":1},{"title":"Brief","body":"write","assignee_id":2,"after":0}]}' }) });
  const tick = () => G.workerTick({ st, secret, wpSearch: async () => [], wpChunks: async () => [], getName: async () => 'Owner' });
  assert.equal((await tick()).started, 1, 'second task waits for the first');
  assert.ok(await until(() => board(st, email).find((x) => x.id === tasks[0].id).status === 'review'));
  assert.equal((await tick()).started, 1);
  assert.ok(await until(() => board(st, email).find((x) => x.id === tasks[1].id).status === 'review'));
  assert.equal(board(st, email).find((x) => x.id === parent.id).status, 'review', 'goal moves to review with its children');
  await assert.rejects(G.decideTask(st, email, parent.id + 'x', true, secret), /No such task/);
  const d1 = await G.decideTask(st, email, tasks[0].id, true, secret);
  assert.equal(d1.task.status, 'done');
  const d2 = await G.decideTask(st, email, tasks[1].id, false, secret, 'too long');
  assert.equal(d2.task.status, 'blocked'); assert.match(d2.task.err, /Rejected: too long/);
  await assert.rejects(G.decideTask(st, email, tasks[1].id, true, secret), /Only tasks in review/);
  // a send task that the agent could not confirm is blocked with the reason
  const s = await G.addTask(st, email, { gid: f.id, title: 'Reply', aid: 1, send: { url: 'https://x.com/p/1', platform: 'X', to: '@a', text: 'Thanks!' } });
  await tick();
  assert.ok(await until(() => board(st, email).find((x) => x.id === s.id).status === 'blocked'));
  assert.match(board(st, email).find((x) => x.id === s.id).err, /Not sent/);
  // cancel
  const c = await G.addTask(st, email, { gid: 'none', title: 'Later' });
  const cancelled = await G.cancelTask(st, email, c.id, 'not needed');
  assert.match(cancelled.err, /Cancelled: not needed/);
  await assert.rejects(G.cancelTask(st, email, c.id), /already blocked/);
  await assert.rejects(G.cancelTask(st, email, 'nope'), /No such task/);
  // restart recovery
  const r = await G.addTask(st, email, { gid: 'none', title: 'Was running', status: 'running' });
  await G.resetInterrupted(st);
  assert.equal(board(st, email).find((x) => x.id === r.id).status, 'todo');
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(events.includes('review') && events.includes('done') && events.includes('cancelled'));
  off(); G.notify({ kind: 'brief' });
});

test('routines: daily time, one-off, pause and resume', async () => {
  const st = memStore(), email = 'r@example.com';
  const t = G.nextAt(9, 30, 'Asia/Kolkata', Date.parse('2026-11-25T10:00:00+05:30'));
  assert.equal(new Date(t).toISOString(), '2026-11-26T04:00:00.000Z');
  const d = await G.saveRoutine(st, email, { aid: 1, title: 'Morning brief', prompt: 'Summarise', hour: 8, minute: 5 });
  assert.equal(d.hour, 8); assert.ok(d.next > Date.now());
  const same = await G.saveRoutine(st, email, { aid: 1, title: 'Morning brief', prompt: 'Summarise again', hour: 9 });
  assert.equal(same.id, d.id, 'same title + agent updates it');
  const once = await G.saveRoutine(st, email, { aid: 'assistant', title: 'Follow up', prompt: 'Ping Ravi', run_at: new Date(Date.now() + 864e5).toISOString(), repeat_every_days: 3 });
  assert.equal(once.every, 3); assert.equal(once.aid, 'assistant');
  await assert.rejects(G.saveRoutine(st, email, { run_at: 'not a date', title: 'x', prompt: 'y' }), /ISO date/);
  await assert.rejects(G.saveRoutine(st, email, { run_at: '2026-12-01T10:00:00Z' }), /title and the instructions/);
  await assert.rejects(G.saveRoutine(st, email, { run_at: '2099-01-01T00:00:00Z', title: 'x', prompt: 'y' }), /too far ahead/);
  await assert.rejects(G.saveRoutine(st, email, { hour: 'x', title: 'a', prompt: 'b' }), /Give the hour/);
  await assert.rejects(G.saveRoutine(st, email, { hour: 3 }), /title and the instructions/);
  const p = await G.setRoutinePaused(st, email, d.id, true); assert.equal(p.paused, true);
  const all = JSON.parse(st.m.get('as_rt:' + email)); all.find((x) => x.id === d.id).next = 1; st.m.set('as_rt:' + email, JSON.stringify(all));
  const resumed = await G.setRoutinePaused(st, email, d.id, false);
  assert.ok(resumed.next > Date.now(), 'resuming never fires a backlog');
  await assert.rejects(G.setRoutinePaused(st, email, 'nope', true), /No such routine/);
});
