import {TMUX_PREFIX} from '../types.js';
import {dockerExec} from './docker.js';

function sessionName(name: string): string {
  return `${TMUX_PREFIX}-${name}`;
}

export async function tmuxNewSession(name: string, command?: string): Promise<void> {
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
}

export async function tmuxSendKeys(name: string, keys: string, literal = false): Promise<void> {
  const args = ['tmux', 'send-keys'];
  if (literal) args.push('-l');
  args.push('-t', sessionName(name), keys);
  await dockerExec(name, args);
}

export async function tmuxCapture(name: string, lines = 200): Promise<string> {
  return await dockerExec(name, [
    'tmux', 'capture-pane', '-p',
    '-t', sessionName(name),
    '-S', `-${lines}`,
  ]);
}

export async function tmuxCaptureAnsi(name: string, lines = 50): Promise<string> {
  return await dockerExec(name, [
    'tmux', 'capture-pane', '-e', '-p',
    '-t', sessionName(name),
    '-S', `-${lines}`,
  ]);
}

export async function tmuxKill(name: string): Promise<void> {
  try {
    await dockerExec(name, ['tmux', 'kill-session', '-t', sessionName(name)]);
  } catch {
    // Session may not exist
  }
}

export async function tmuxHasSession(name: string): Promise<boolean> {
  try {
    await dockerExec(name, ['tmux', 'has-session', '-t', sessionName(name)]);
    return true;
  } catch {
    return false;
  }
}
