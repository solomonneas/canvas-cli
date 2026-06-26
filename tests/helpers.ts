import type {
  BrowserBridgeInvokeArgs,
  BrowserBridgeResponse,
  BrowserBridgeRunner,
} from '../src/browser-bridge.js';
import type { CommandIo } from '../src/types.js';

export function makeRunner(
  byAction: Record<string, BrowserBridgeResponse<unknown>>,
): { runner: BrowserBridgeRunner; calls: BrowserBridgeInvokeArgs[] } {
  const calls: BrowserBridgeInvokeArgs[] = [];
  const runner: BrowserBridgeRunner = {
    async invoke<T = unknown>(args: BrowserBridgeInvokeArgs): Promise<BrowserBridgeResponse<T>> {
      calls.push(args);
      const value = byAction[args.action];
      if (!value) {
        return {
          ok: false,
          error: { code: 'no_mock', message: `no mock for ${args.action}` },
        } as BrowserBridgeResponse<T>;
      }
      return value as BrowserBridgeResponse<T>;
    },
  };
  return { runner, calls };
}

export function makeIo(): CommandIo & { stdoutLines: string[]; stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stderrLines,
    stdout: (message) => stdoutLines.push(message),
    stderr: (message) => stderrLines.push(message),
  };
}
