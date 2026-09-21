import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { DshLifecycle } from './lifecycle.mjs';
import { DshTransport } from './transport.mjs';

export class DshBackend extends EventEmitter {
  constructor(options) {
    super();
    this.lifecycle = new DshLifecycle(options);
    this.transport = new DshTransport(this.lifecycle);
    this.followers = new Map();
    this.pendingApprovals = new Map();
    this.lifecycle.on('status', status => this.publish('', 'runtime', status));
  }

  publish(sessionId, type, data) {
    this.emit('event', { sessionId, type, data, generation: this.lifecycle.generation });
  }
  async start() {
    const health = await this.lifecycle.start();
    if (!this.eventsOpening) {
      this.eventsOpening = this.transport.open('$events', {}, frame => {
        if (frame.type === 'ready') this.eventClientId = frame.clientId;
        if (frame.type === 'waterfall') {
          if (frame.event === 'approval/request') {
            this.pendingApprovals.set(frame.eventId, frame);
            this.publish(frame.agentId, 'approval', { ...frame.request, requestId: frame.eventId });
          } else {
            void this.transport.call('$events/result', {
              clientId: this.eventClientId, eventId: frame.eventId, outcome: { kind: 'next' },
            }).catch(error => this.publish(frame.agentId, 'error', error.message));
          }
        }
        if (frame.type === 'cancel') {
          const pending = this.pendingApprovals.get(frame.eventId);
          this.pendingApprovals.delete(frame.eventId);
          if (pending) this.publish(pending.agentId, 'approval_end', { requestId: frame.eventId });
        }
      }, error => {
        this.eventsOpening = undefined;
        this.publish('', 'error', error.message);
      }).catch(error => { this.eventsOpening = undefined; throw error; });
    }
    await this.eventsOpening;
    return health;
  }
  async health() {
    const health = this.lifecycle.health();
    if (health.state !== 'ready') return health;
    try {
      const response = await this.lifecycle.request('/', { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return health;
    } catch {
      return { ...health, state: 'error', error: 'DeepSeek Harness is not responding. Restart Runtime or open logs.' };
    }
  }
  async stop() {
    this.transport.close();
    this.followers.clear();
    this.pendingApprovals.clear();
    this.eventsOpening = undefined;
    await this.lifecycle.stop();
  }
  async restart() { await this.stop(); return this.start(); }
  async getLogsPath() { return this.lifecycle.logsPath; }
  async listModels() {
    await this.start();
    const catalog = await this.transport.call('session/modelCatalog');
    return catalog.groups.flatMap(group => group.models.map(model => ({
      provider: group.id, model: model.id, label: `${group.name} / ${model.name}`,
    })));
  }
  async listSessions(workspacePath) {
    await this.start();
    const path = await realpath(workspacePath);
    const result = await this.transport.call('session/list', { _request: {} });
    return result.items.filter(item => samePath(item.cwd, path) && item.origin !== 'subagent')
      .map(item => ({ id: item.sessionId, title: item.projections?.values?.title || 'New Session', workspacePath: item.cwd }));
  }
  async configureProvider({ provider, api, baseURL, model, apiKey }) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(provider)) throw new Error('Provider ID must use lowercase letters, digits and hyphens.');
    if (!apiKey?.trim()) throw new Error('Enter an API key.');
    await this.start();
    if (provider === 'deepseek-official') {
      await this.transport.call('credentials/set', { ref: 'DEEPSEEK_API_KEY', value: apiKey.trim() });
      return;
    }
    if (!['openai-completions', 'anthropic-messages'].includes(api)) throw new Error('Unsupported model protocol.');
    const url = new URL(baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP(S) model endpoint without embedded credentials.');
    if (!model?.trim()) throw new Error('Enter a model ID.');
    const ref = `DCODE_${provider.toUpperCase().replaceAll('-', '_')}_API_KEY`;
    await this.transport.call('credentials/set', { ref, value: apiKey.trim() });
    await this.transport.call('settings/update', { ns: 'llm-pi-ai', patch: { providers: {
      [provider]: { displayName: provider, apiKeyEnv: ref, api, baseURL: url.href.replace(/\/$/, ''),
        models: [{ id: model.trim(), name: model.trim(), contextWindow: 128000, maxTokens: 8192 }],
      },
    } } });
  }
  async createSession(workspacePath, model) {
    const cwd = await realpath(workspacePath);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Open an existing project folder first.');
    await this.start();
    const result = await this.transport.call('session/create', { request: { cwd } });
    if (model) await this.selectModel(result.sessionId, model);
    return { id: result.sessionId, title: 'New Session', workspacePath: cwd };
  }
  async selectModel(sessionId, model) {
    await this.transport.call('session/selectModel', {
      request: { sessionId, provider: model.provider, model: model.model },
    });
  }
  async resumeSession(sessionId) {
    await this.start();
    // Workspace panels may remain mounted in the background. Keep their
    // independent subscriptions; reconnect only the requested session.
    this.followers.get(sessionId)?.();
    this.followers.delete(sessionId);
    let resolveSnapshot, rejectSnapshot;
    const snapshot = new Promise((resolve, reject) => { resolveSnapshot = resolve; rejectSnapshot = reject; });
    void snapshot.catch(() => {});
    const timeout = setTimeout(() => rejectSnapshot(new Error('Session history timed out. Retry or restart Runtime.')), 30_000);
    let dispose;
    try {
    dispose = await this.transport.open('session/follow', {
      request: { address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 200 },
    }, frame => {
      if (frame.type === 'snapshot') resolveSnapshot(frame);
      this.publish(sessionId, frame.type, frame);
    }, error => {
      rejectSnapshot(error);
      this.followers.delete(sessionId);
      this.publish(sessionId, 'error', error.message);
    });
    this.followers.set(sessionId, dispose);
    return await snapshot;
    } catch (error) { dispose?.(); this.followers.delete(sessionId); throw error; }
    finally { clearTimeout(timeout); }
  }
  async sendMessage(sessionId, message, model) {
    if (!message.trim()) throw new Error('Enter a message first.');
    await this.start();
    if (!this.followers.has(sessionId)) await this.resumeSession(sessionId);
    if (model) await this.selectModel(sessionId, model);
    await this.transport.call('session/prompt', { request: {
      requestId: randomUUID(), sessionId, mode: 'queue',
      content: [{ type: 'text', text: message }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    } });
  }
  async cancel(sessionId) {
    await this.transport.call('session/cancel', { request: { sessionId } });
  }
  async respondApproval(sessionId, requestId, approved) {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending || pending.agentId !== sessionId) throw new Error('This approval is no longer pending.');
    await this.transport.call('$events/result', {
      clientId: this.eventClientId, eventId: requestId,
      outcome: { kind: 'result', value: approved ? 'allowed-once' : 'rejected' },
    });
    this.pendingApprovals.delete(requestId);
    this.publish(sessionId, 'approval_end', { requestId });
  }
}

function samePath(left, right) {
  if (!left) return false;
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
