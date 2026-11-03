// Composio without a developer key: each AaaS owner signs in with their OWN Composio account (Composio's consumer
// sign-in, OAuth with PKCE and dynamic client registration, nothing to put in .env), and their agents reach the apps
// connected in that account through Composio's hosted MCP server. Connecting an app returns Composio's sign-in link
// (Google, Slack, …) and the connection lives in the owner's Composio account.
//
// - Tokens are stored per owner, encrypted with the server secret (AES-256-GCM via the sealer passed in).
// - Every tool call still goes through AaaS's agent loop: reads run, anything that changes an app waits for approval.
// - COMPOSIO_MCP_URL overrides the server (tests use a local one). COMPOSIO_ACCOUNT=off turns this mode off.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

const env = (k) => (process.env[k] ?? '').toString().trim();
export const accountMcpUrl = () => env('COMPOSIO_MCP_URL') || 'https://connect.composio.dev/mcp';
export const accountModeOn = () => env('COMPOSIO_ACCOUNT').toLowerCase() !== 'off';
const KEY = (email) => 'as_cfy:' + email;
// meta tools that are not for agents (sandbox shells, feedback, blocking waits)
const HIDDEN = /REMOTE_BASH|REMOTE_WORKBENCH|SKILL|SUBMIT_FEEDBACK|WAIT_FOR_CONNECTIONS/;

// per-owner live state (one process): MCP client, its tool list, connected app slugs, a sign-in waiting for its code
const live = new Map();
const L = (email) => { let x = live.get(email); if (!x) { x = { client: null, tools: [], connected: [], pending: null, connecting: null }; live.set(email, x); } return x; };

async function loadStored(ctx) {
  const row = await ctx.st.get(KEY(ctx.email));
  if (!row || !row.v) return {};
  try { return (await ctx.open(row.v)) || {}; } catch { return {}; }
}
async function saveStored(ctx, patch) {
  const cur = { ...(await loadStored(ctx)), ...patch };
  for (const k of Object.keys(cur)) if (cur[k] === undefined) delete cur[k];
  await ctx.st.put(KEY(ctx.email), Object.keys(cur).length ? await ctx.seal(cur) : null, Date.now());
}

// The OAuth client side for one owner. The SDK runs discovery, registration, PKCE and token refresh; we store the pieces.
class OwnerAuth {
  constructor(ctx, redirect, state) { this.ctx = ctx; this.redirect = redirect; this.st = state; this.pendingUrl = null; }
  get redirectUrl() { return this.redirect; }
  get clientMetadata() {
    return { client_name: 'AaaS', redirect_uris: [this.redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  state() { return this.st || ''; }
  async clientInformation() {
    const s = await loadStored(this.ctx);
    // registered for another address of this server (e.g. localhost vs 127.0.0.1): register again
    if (s.client && s.redirect && s.redirect !== this.redirect) return undefined;
    return s.client;
  }
  async saveClientInformation(client) { await saveStored(this.ctx, { client, redirect: this.redirect }); }
  async tokens() { return (await loadStored(this.ctx)).tokens; }
  async saveTokens(tokens) { await saveStored(this.ctx, { tokens, at: Date.now() }); }
  redirectToAuthorization(url) { this.pendingUrl = url; }
  async saveCodeVerifier(verifier) { await saveStored(this.ctx, { verifier }); }
  async codeVerifier() { const v = (await loadStored(this.ctx)).verifier; if (!v) throw new Error('The sign-in expired. Start it again.'); return v; }
  async saveDiscoveryState(discovery) { await saveStored(this.ctx, { discovery }); }
  async discoveryState() { return (await loadStored(this.ctx)).discovery; }
  async invalidateCredentials(scope) {
    if (scope === 'all') await this.ctx.st.put(KEY(this.ctx.email), null, Date.now());
    else await saveStored(this.ctx, { [scope === 'client' ? 'client' : scope]: undefined });
  }
}

// Connect with saved tokens. Returns { url } when the owner has to sign in (again), else null.
async function connect(ctx, redirect = '', state = '') {
  const x = L(ctx.email), stored = await loadStored(ctx);
  const auth = new OwnerAuth(ctx, redirect || stored.redirect || 'http://localhost/api/connectors/account/callback', state);
  const transport = new StreamableHTTPClientTransport(new URL(accountMcpUrl()), { authProvider: auth });
  const client = new Client({ name: 'aaas', version: '1.0.0' });
  try { await client.connect(transport); }
  catch (e) {
    if (e instanceof UnauthorizedError && auth.pendingUrl) { x.pending = { transport, at: Date.now() }; return { url: auth.pendingUrl.toString() }; }
    throw e;
  }
  x.client = client; x.pending = null;
  await refreshAccount(ctx);
  return null;
}

export async function accountSignedIn(ctx) { return !!L(ctx.email).client || !!(await loadStored(ctx)).tokens; }

async function ensureClient(ctx) {
  const x = L(ctx.email);
  if (x.client) return x.client;
  if (!(await loadStored(ctx)).tokens) throw Object.assign(new Error('Sign in to Composio first (Apps → Sign in to Composio).'), { status: 409, code: 'composio_signin' });
  x.connecting ??= connect(ctx).then((r) => { if (r) throw Object.assign(new Error('Your Composio sign-in expired. Sign in again from Apps.'), { status: 409, code: 'composio_signin' }); }).finally(() => { x.connecting = null; });
  await x.connecting;
  return x.client;
}

// Start signing in: Composio's authorization URL, or null when already signed in.
export async function accountSignIn(ctx, redirect, state) {
  const x = L(ctx.email);
  if (x.client) return null;
  const r = await connect(ctx, redirect, state);
  return r ? r.url : null;
}
// Composio sends the browser back with ?code=: finish and connect.
export async function accountFinish(ctx, code) {
  const x = L(ctx.email);
  if (!x.pending) throw new Error('No Composio sign-in is in progress here (the server may have restarted). Start again from Apps.');
  await x.pending.transport.finishAuth(code);
  x.pending = null;
  const r = await connect(ctx);
  if (r) throw new Error('The Composio sign-in didn’t complete. Try again.');
}
export async function accountSignOut(ctx) {
  const x = L(ctx.email);
  await x.client?.close().catch(() => {});
  live.delete(ctx.email);
  await ctx.st.put(KEY(ctx.email), null, Date.now());
}

// Which apps the account has connected: Composio lists them in its search tool's description; checks add to it.
export async function refreshAccount(ctx) {
  const x = L(ctx.email), client = await ensureClient(ctx);
  const { tools } = await client.listTools();
  x.tools = (tools || []).filter((t) => !HIDDEN.test(t.name));
  const desc = (tools || []).map((t) => t.description || '').join('\n');
  const m = desc.match(/connected (?:the )?apps?:\s*([^.\n]+)/i);
  if (m) x.connected = [...new Set(m[1].split(',').map((s) => s.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')).filter((s) => /^[a-z0-9_]{2,60}$/.test(s)))];
  await saveStored(ctx, { connected: x.connected });
  return x.connected;
}
export async function accountConnected(ctx) {
  const x = L(ctx.email);
  if (x.connected.length || x.client) return x.connected;
  return (await loadStored(ctx)).connected || [];
}
export async function accountTools(ctx) { const x = L(ctx.email); if (!x.tools.length) await refreshAccount(ctx); return x.tools; }

const clipText = (s, n = 30000) => (s.length > n ? s.slice(0, n) + '…[truncated]' : s);
export async function accountCall(ctx, name, args = {}) {
  const run = async () => {
    const client = await ensureClient(ctx);
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 5 * 60e3 });
    const text = (res.content || []).map((c) => (c.type === 'text' ? c.text : '[' + c.type + ']')).join('\n');
    return (res.isError ? 'Error: ' : '') + clipText(text || '(no output)');
  };
  try { return await run(); }
  catch (e) {
    if (e && e.code === 'composio_signin') throw e;
    L(ctx.email).client = null; // the session dropped: reconnect once with the saved tokens
    return run();
  }
}

export async function accountIsConnected(ctx, slug) {
  const x = L(ctx.email);
  if (x.connected.includes(slug)) return true;
  const out = await accountCall(ctx, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: slug, action: 'list' }] });
  const on = /"status"\s*:\s*"ACTIVE"/i.test(out);
  if (on) { x.connected = [...new Set([...x.connected, slug])]; await saveStored(ctx, { connected: x.connected }); }
  return on;
}
// Composio's sign-in link for one app, or { already: true }.
export async function accountConnect(ctx, slug) {
  if (await accountIsConnected(ctx, slug)) return { already: true };
  const out = await accountCall(ctx, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: slug, action: 'add' }] });
  const url = (out.match(/"redirect_url"\s*:\s*"([^"]+)"/) || [])[1] || (out.match(/https:\/\/[^\s"')\]]+/) || [])[0];
  if (!url || !/^https:\/\//.test(url)) throw new Error('Composio didn’t return a sign-in link for ' + slug + '. ' + out.slice(0, 200));
  return { url };
}
export async function accountDisconnect(ctx, slug) {
  const x = L(ctx.email);
  const out = await accountCall(ctx, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: slug, action: 'remove' }] }).catch((e) => 'Error: ' + e.message);
  x.connected = x.connected.filter((s) => s !== slug); await saveStored(ctx, { connected: x.connected });
  return out;
}

// read vs write for COMPOSIO_MULTI_EXECUTE_TOOL: reads run now, anything else waits for approval
const READ_VERB = /_(GET|LIST|SEARCH|FETCH|FIND|READ|RETRIEVE|QUERY|DESCRIBE|LOOKUP|VIEW|CHECK|COUNT|EXPORT|DOWNLOAD)(_|$)/;
export const execItems = (args) => (args && Array.isArray(args.tools) ? args.tools : []);
export const execIsRead = (args) => { const it = execItems(args); return it.length > 0 && it.every((i) => READ_VERB.test(String(i.tool_slug || '').toUpperCase())); };
export const _forTests = { live };
