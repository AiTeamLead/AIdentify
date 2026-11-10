import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function chromiumPath() {
  const found = [];
  if (process.env.BROWSER_EXECUTABLE) found.push(process.env.BROWSER_EXECUTABLE);
  found.push('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cache)) {
    for (const name of fs.readdirSync(cache)) {
      if (!name.startsWith('chromium-') || name.includes('headless')) continue;
      found.push(path.join(cache, name, 'chrome-linux64', 'chrome'));
    }
  }
  return found.find((p) => p && fs.existsSync(p)) || '';
}
