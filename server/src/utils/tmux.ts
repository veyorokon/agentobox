import {TMUX_PREFIX} from '../types.js';
import {dockerExec} from './docker.js';
import {withSpan} from '../telemetry.js';

function sessionName(name: string): string {
  return `${TMUX_PREFIX}-${name}`;
}

export async function tmuxNewSession(name: string, command?: string): Promise<void> {
  return withSpan('tmux.new_session', {'tmux.session': name}, async () => {
    await dockerExec(name, [
      'tmux', 'new-session', '-d',
      '-s', sessionName(name),
      '-x', '220',
      '-y', '50',
    ]);

    if (command) {
      await dockerExec(name, [
        'tmux', 'send-keys', '-t', sessionName(name), command, 'Enter',
      ]);
    }
  });
}

export async function tmuxSendKeys(name: string, keys: string, literal = false): Promise<void> {
  return withSpan('tmux.send_keys', {'tmux.session': name, 'tmux.literal': literal}, async () => {
    const args = ['tmux', 'send-keys'];
    if (literal) args.push('-l');
    args.push('-t', sessionName(name), keys);
    await dockerExec(name, args);
  });
}

export async function tmuxCapture(name: string, lines = 200): Promise<string> {
  return withSpan('tmux.capture', {'tmux.session': name, 'tmux.lines': lines}, async () => {
    return await dockerExec(name, [
      'tmux', 'capture-pane', '-p',
      '-t', sessionName(name),
      '-S', `-${lines}`,
    ]);
  });
}

export async function tmuxCaptureAnsi(name: string, lines = 50): Promise<string> {
  return withSpan('tmux.capture_ansi', {'tmux.session': name, 'tmux.lines': lines}, async () => {
    return await dockerExec(name, [
      'tmux', 'capture-pane', '-e', '-p',
      '-t', sessionName(name),
      '-S', `-${lines}`,
    ]);
  });
}

export async function tmuxKill(name: string): Promise<void> {
  return withSpan('tmux.kill', {'tmux.session': name}, async () => {
    try {
      await dockerExec(name, ['tmux', 'kill-session', '-t', sessionName(name)]);
    } catch {
      // Session may not exist
    }
  });
}

export async function tmuxHasSession(name: string): Promise<boolean> {
  return withSpan('tmux.has_session', {'tmux.session': name}, async (span) => {
    try {
      await dockerExec(name, ['tmux', 'has-session', '-t', sessionName(name)]);
      span.setAttribute('tmux.exists', true);
      return true;
    } catch {
      span.setAttribute('tmux.exists', false);
      return false;
    }
  });
}
