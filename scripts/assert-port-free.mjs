import net from 'node:net';

const port = Number.parseInt(process.argv[2] ?? '', 10);
const host = '127.0.0.1';

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('Usage: node scripts/assert-port-free.mjs <port>');
  process.exit(1);
}

const socket = net.createConnection({ host, port });

socket.once('connect', () => {
  socket.destroy();
  console.error(
    `Port ${port} is already in use. Stop the existing dev server before running pnpm dev so Electron cannot attach to stale renderer code.`,
  );
  process.exit(1);
});

socket.once('error', (error) => {
  if (error.code === 'ECONNREFUSED') {
    process.exit(0);
  }

  console.error(`Could not check port ${port}: ${error.message}`);
  process.exit(1);
});
