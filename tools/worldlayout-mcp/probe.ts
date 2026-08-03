/** Rauchtest des MCP-Servers: Tools listen, Probe + Get aufrufen. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const t = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'tools/worldlayout-mcp/server.ts'],
  cwd: '/root/worldofvikings',
});
const c = new Client({ name: 'probe', version: '0' });
await c.connect(t);
const tools = await c.listTools();
console.log('tools:', tools.tools.map((x) => x.name).join(', '));
const probe = await c.callTool({ name: 'layout_probe', arguments: { punkte: [[0, 0], [2500, 0], [-6000, 0]] } });
console.log((probe.content as Array<{ text: string }>)[0]!.text);
const get = await c.callTool({ name: 'layout_get', arguments: {} });
console.log((get.content as Array<{ text: string }>)[0]!.text.split('\n').slice(0, 4).join('\n'));
await c.close();
