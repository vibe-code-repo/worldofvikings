/**
 * Startet Server und Client parallel im Vordergrund — die Variante ohne
 * systemd, z. B. wenn man beide Logs in einem Terminal sehen will.
 * Für den Dauerbetrieb stattdessen: systemctl start valheim.target
 */
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tasks = [
  { name: 'server', script: 'dev:server' },
  { name: 'client', script: 'dev:client' },
];

const children = tasks.map(({ name, script }) => {
  const child = spawn(npm, ['run', script], { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${name}] beendet (code=${code} signal=${signal}) — fahre alles herunter`);
    shutdown(code ?? 1);
  });
  return child;
});

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
