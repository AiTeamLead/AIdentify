// Programs are started from fixed system folders, not looked up through PATH (SonarQube S4036: a writable folder
// early in PATH could shadow git, sh, bwrap or cloudflared). Falls back to the bare name only when the program is in
// none of these folders, which keeps installs in unusual places working.
import fs from 'node:fs';
import path from 'node:path';

const WIN = process.platform === 'win32';
const sysRoot = process.env.SystemRoot || 'C:\\Windows';
const DIRS = WIN
  ? [path.join(sysRoot, 'System32'), path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0'), 'C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\Git\\bin', 'C:\\Program Files\\cloudflared', 'C:\\Program Files (x86)\\cloudflared']
  : ['/usr/local/bin', '/usr/bin', '/bin', '/usr/local/sbin', '/usr/sbin', '/sbin', '/opt/homebrew/bin', '/snap/bin'];
const cache = new Map();

export function bin(name) {
  if (cache.has(name)) return cache.get(name);
  const names = WIN && !path.extname(name) ? [name + '.exe', name + '.cmd'] : [name];
  let found = name;
  outer: for (const d of DIRS) for (const n of names) {
    const p = path.join(d, n);
    try { if (fs.statSync(p).isFile()) { found = p; break outer; } } catch { /* not here */ }
  }
  cache.set(name, found);
  return found;
}
