import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

/** Official Connection unary envelope + Gateway Remote mux, without UI coupling. */
export class DshTransport {
  constructor(lifecycle) {
    this.lifecycle = lifecycle;
    this.sockets = new Set();
  }

  async call(endpoint, args = {}, raw = false) {
    const rpcId = randomUUID();
    const response = await this.lifecycle.request(`/api/${endpoint}`, {
      method: 'POST', body: JSON.stringify({
        type: 'client-request', rpcId, method: endpoint,
        payload: raw ? args : { args },
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek Harness request failed (HTTP ${response.status}). Restart Runtime or open logs.`);
    const envelope = await response.json();
    if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
      throw new Error('DeepSeek Harness returned an invalid response.');
    }
    if (!envelope.result?.ok) {
      const error = new Error(envelope.result?.error?.message ?? 'DeepSeek Harness request failed');
      error.code = envelope.result?.error?.code;
      throw error;
    }
    return envelope.result.value;
  }

  async open(endpoint, args, onValue, onError) {
    await this.lifecycle.start();
    const url = new URL('/api/remote.mux', this.lifecycle.origin);
    url.protocol = 'ws:';
    const socket = new WebSocket(url, {
      headers: { cookie: this.lifecycle.cookie, origin: this.lifecycle.origin },
      handshakeTimeout: 10_000,
    });
    const streamId = randomUUID();
    this.sockets.add(socket);
    let closed = false;
    let opened = false;
    const dispose = () => {
      closed = true;
      this.sockets.delete(socket);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'cancel', streamId }));
        socket.close();
      } else socket.terminate();
    };
    socket.on('message', bytes => {
      if (closed) return;
      try {
        const message = JSON.parse(bytes.toString());
        if (message.streamId !== streamId) return;
        if (message.type === 'item') onValue(message.value);
        else if (message.type === 'error') throw new Error(message.error?.message ?? 'Agent stream failed');
        else if (message.type === 'end') throw new Error('Agent stream ended unexpectedly. Reopen the session.');
      } catch (error) { onError(error); dispose(); }
    });
    socket.on('close', () => {
      this.sockets.delete(socket);
      if (!closed && opened) onError(new Error('Agent disconnected. Restart Runtime and reopen the session.'));
      closed = true;
    });
    await new Promise((resolve, reject) => {
      socket.once('open', () => {
        opened = true;
        socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
        resolve();
      });
      socket.on('error', error => {
        const failure = new Error('Cannot connect to DeepSeek Harness. Restart Runtime or open logs.', { cause: error });
        if (!opened) reject(failure);
        else if (!closed) onError(failure);
      });
    }).catch(error => { dispose(); throw error; });
    return dispose;
  }

  close() {
    for (const socket of this.sockets) {
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.terminate();
    }
    this.sockets.clear();
  }
}
