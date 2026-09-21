import test from 'node:test';
import assert from 'node:assert/strict';
import { DshTransport } from '../src/transport.mjs';

test('unary calls preserve official named arguments and verify correlation', async () => {
  const transport = new DshTransport({ request: async (path, options) => {
    const request = JSON.parse(options.body);
    assert.equal(path, '/api/session/list');
    assert.deepEqual(request.payload, { args: { _request: {} } });
    return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { items: [] } } });
  } });
  assert.deepEqual(await transport.call('session/list', { _request: {} }), { items: [] });
});
test('mismatched RPC and model failure cannot be shown as a successful answer', async () => {
  const mismatch = new DshTransport({ request: async () => Response.json({ type: 'server-response', rpcId: 'wrong' }) });
  await assert.rejects(mismatch.call('session/modelCatalog'), /invalid response/);
  const failed = new DshTransport({ request: async (_path, options) => Response.json({
    type: 'server-response', rpcId: JSON.parse(options.body).rpcId,
    result: { ok: false, error: { code: 'session/model-unavailable', message: 'Model unavailable' } },
  }) });
  await assert.rejects(failed.call('session/selectModel'), { code: 'session/model-unavailable' });
});
