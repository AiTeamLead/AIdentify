// Long-running WhatsApp QR worker. Vercel and other serverless hosts cannot keep a Baileys socket.
// Run this beside the web server: `node worker.js` or the worker service in docker-compose.yml.
// It resumes saved sessions. It does not send a message that has not been approved.
import './lib/logbuf.js';
import { store } from './lib/backend.js';
import { resumeLinkedSessions } from './lib/waqr.js';

const secret = async () => process.env.SESSION_SECRET || 'worker-local';
const st = await store();
const out = await resumeLinkedSessions(st, secret);
console.log('WhatsApp worker:', JSON.stringify(out));
console.log('Leave this process running. A closed session asks the owner to scan the QR again.');
setInterval(() => { resumeLinkedSessions(st, secret).catch(() => {}); }, 10 * 60 * 1000).unref();
