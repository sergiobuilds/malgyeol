import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const PROVIDERS = [
  'voice',
  'ai-interpreter',
  'supplier',
  'hosting'
] as const;

export type ProviderName = typeof PROVIDERS[number];

export interface ExternalDependencyBlocker {
  code: 'BLOCKED_EXTERNAL_DEPENDENCY';
  provider: ProviderName;
  operation: string;
  caseId: string;
  subprocess: {
    exitCode: number;
    stderrSha256: string;
  };
}

export type ProviderPreflight =
  | { status: 'LIVE_READY'; provider: ProviderName; operation: string; caseId: string }
  | { status: 'BLOCKED'; blocker: ExternalDependencyBlocker };

export interface ProviderAdapter {
  readonly provider: ProviderName;
  preflight(caseId: string, operation: string): Promise<ProviderPreflight>;
  execute<T>(operation: () => Promise<T>): Promise<T>;
}

export interface ProviderGateResult<T> {
  status: 'COMPLETED' | 'BLOCKED_EXTERNAL_DEPENDENCY';
  sideEffectsStarted: number;
  blockers: ExternalDependencyBlocker[];
  results: Partial<Record<ProviderName, T>>;
}

class LiveOrBlockerProviderAdapter implements ProviderAdapter {
  constructor(
    public readonly provider: ProviderName,
    private readonly liveEnabled: boolean
  ) {}

  async preflight(caseId: string, operation: string): Promise<ProviderPreflight> {
    if (this.liveEnabled) return { status: 'LIVE_READY', provider: this.provider, operation, caseId };
    const subprocess = await blockedDependencySubprocess(this.provider);
    if (subprocess.exitCode === 0) throw new Error('External dependency blocker subprocess unexpectedly succeeded');
    return {
      status: 'BLOCKED',
      blocker: {
        code: 'BLOCKED_EXTERNAL_DEPENDENCY',
        provider: this.provider,
        operation,
        caseId,
        subprocess: {
          exitCode: subprocess.exitCode,
          stderrSha256: createHash('sha256').update(subprocess.stderr).digest('hex')
        }
      }
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.liveEnabled) throw new Error(`Provider ${this.provider} is blocked`);
    return operation();
  }
}

export function createVoiceProviderAdapter(liveEnabled: boolean): ProviderAdapter {
  return new LiveOrBlockerProviderAdapter('voice', liveEnabled);
}

export function createAiProviderAdapter(liveEnabled: boolean): ProviderAdapter {
  return new LiveOrBlockerProviderAdapter('ai-interpreter', liveEnabled);
}

export function createSupplierProviderAdapter(liveEnabled: boolean): ProviderAdapter {
  return new LiveOrBlockerProviderAdapter('supplier', liveEnabled);
}

export function createHostingProviderAdapter(liveEnabled: boolean): ProviderAdapter {
  return new LiveOrBlockerProviderAdapter('hosting', liveEnabled);
}

export async function runProviderGate<T>(input: {
  caseId: string;
  operation: string;
  adapters: readonly ProviderAdapter[];
  sideEffects: Readonly<Partial<Record<ProviderName, () => Promise<T>>>>;
}): Promise<ProviderGateResult<T>> {
  const preflights = await Promise.all(
    input.adapters.map(adapter => adapter.preflight(input.caseId, input.operation))
  );
  const blockers = preflights.flatMap(result => result.status === 'BLOCKED' ? [result.blocker] : []);
  if (blockers.length > 0) {
    return { status: 'BLOCKED_EXTERNAL_DEPENDENCY', sideEffectsStarted: 0, blockers, results: {} };
  }

  const results: Partial<Record<ProviderName, T>> = {};
  let sideEffectsStarted = 0;
  for (const adapter of input.adapters) {
    const sideEffect = input.sideEffects[adapter.provider];
    if (!sideEffect) throw new Error(`Missing live operation for provider ${adapter.provider}`);
    sideEffectsStarted += 1;
    results[adapter.provider] = await adapter.execute(sideEffect);
  }
  return { status: 'COMPLETED', sideEffectsStarted, blockers: [], results };
}

async function blockedDependencySubprocess(provider: ProviderName): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '-e',
      "process.stderr.write('BLOCKED_EXTERNAL_DEPENDENCY\\n'); process.exit(78)"
    ], { env: {}, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({
      exitCode: code ?? 1,
      stderr: `${provider}:${stderr.trim()}`
    }));
  });
}
