import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function createFixture(root) {
const workspace = join(root, 'project');
await mkdir(workspace, { recursive: true });
await mkdir(join(root, 'dsh'), { recursive: true });
await writeFile(join(workspace, 'input.txt'), 'DCode input\n');
await writeFile(join(workspace, 'output.txt'), 'baseline\n');
process.env.DCODE_FIXTURE_KEY = 'synthetic-local-test-key';
const commands = [
  ['read', { file_path: 'input.txt' }],
  ['grep', { pattern: 'DCode input', include: 'input.txt' }],
  ['read', { file_path: 'output.txt' }],
  ['write', { file_path: 'output.txt', content: 'first version\n' }],
  ['edit', { file_path: 'output.txt', old_string: 'first version', new_string: 'edited version' }],
  ['pwsh', { command: "Get-Content -LiteralPath './output.txt'; Write-Output 'DCODE_SHELL_OK'", description: 'Verify project output' }],
];
const requests = [];
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.headers.authorization, 'Bearer synthetic-local-test-key');
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (delta, finish = null) => response.write(`data: ${JSON.stringify({
      id: 'dcode-fixture', object: 'chat.completion.chunk', created: 0, model: 'dcode-fixture',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`);
    const toolResults = (body.messages ?? []).filter(message => message.role === 'tool').length;
    const lastHumanUser = (body.messages ?? []).filter(message => message.role === 'user' &&
      !String(message.content).startsWith('Current runtime context.') &&
      !String(message.content).includes('<available_skills>')).at(-1);
    if (JSON.stringify(lastHumanUser).includes('DCODE_CANCEL_TEST')) {
      for (let index = 0; index < 600 && !response.destroyed; index++) {
        send({ role: 'assistant', content: `Waiting ${index}. ` }); await delay(100);
      }
      response.end('data: [DONE]\n\n');
      return;
    }
    if (JSON.stringify(lastHumanUser).includes('DCODE_SECOND_SESSION')) {
      send({ role: 'assistant', content: 'DCODE_SECOND_SESSION_REPLY' });
      send({}, 'stop');
      response.end('data: [DONE]\n\n');
      return;
    }
    if ((body.tools?.length ?? 0) > 0 && toolResults < commands.length) {
      const [name, args] = commands[toolResults];
      assert.ok(body.tools.some(tool => tool.function?.name === name), `${name} tool missing`);
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${toolResults}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      send({}, 'tool_calls');
    } else {
      send({ role: 'assistant', reasoning_content: 'Checked the project files and command output.' });
      for (const content of ['DCode ', 'streaming ', 'complete.']) {
        send({ role: 'assistant', content }); await delay(80);
      }
      send({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  } catch (error) { response.destroy(error); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
await writeFile(join(root, 'dsh', 'settings.yaml'), JSON.stringify({ 'llm-pi-ai': { providers: {
  'dcode-fixture': { displayName: 'DCode Local Fixture', apiKeyEnv: 'DCODE_FIXTURE_KEY',
    api: 'openai-completions', baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    models: [{ id: 'dcode-fixture', name: 'DCode Fixture', contextWindow: 100000, maxTokens: 4096 }],
  },
} } }));

return { workspace, server, requests, commands };
}
