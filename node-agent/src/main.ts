import { createNodeAgentServer, listenNodeAgentServer } from './http.js';

const token = process.env.NODE_AGENT_SHARED_SECRET;
const host = process.env.NODE_AGENT_HOST ?? '0.0.0.0';
const rawPort = process.env.NODE_AGENT_PORT ?? '9443';
const port = Number.parseInt(rawPort, 10);

if (token === undefined || token.length < 32) throw new Error('NODE_AGENT_SHARED_SECRET must be at least 32 characters.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('NODE_AGENT_PORT must be an integer between 1 and 65535.');

const server = createNodeAgentServer({ token });
await listenNodeAgentServer(server, host, port);
process.stdout.write(`RuangNode Node Agent listening on ${host}:${port}\n`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(() => process.exit(0)); });
}