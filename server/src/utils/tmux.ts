import {TMUX_PREFIX} from '../types.js';
import {dockerExec} from './docker.js';

function sessionName(name: string): string {
  return `${TMUX_PREFIX}-${name}`;
}

export function tmuxNewSession(name: string, command?: string): void {
  dockerExec(name, [
    'tmux', 'new-session', '-d',
    '-s', sessionName(name),
    '-x', '220',
    '-y', '50',
  ]);

  if (command) {
    dockerExec(name, [
      'tmux', 'send-keys', '-t', sessionName(name), command, 'Enter',
    ]);
  }
}

export function tmuxSendKeys(name: string, keys: string, literal = false): void {
  const args = ['tmux', 'send-keys'];
  if (literal) args.push('-l');
  args.push('-t', sessionName(name), keys);
  dockerExec(name, args);
}

export function tmuxCapture(name: string, lines = 200): string {
  return dockerExec(name, [
    'tmux', 'capture-pane', '-p',
    '-t', sessionName(name),
    '-S', `-${lines}`,
  ]);
}

export function tmuxCaptureAnsi(name: string, lines = 50): string {
  return dockerExec(name, [
    'tmux', 'capture-pane', '-e', '-p',
    '-t', sessionName(name),
    '-S', `-${lines}`,
  ]);
}

export function tmuxKill(name: string): void {
  try {
    dockerExec(name, ['tmux', 'kill-session', '-t', sessionName(name)]);
  } catch {
    // Session may not exist
  }
}

export function tmuxHasSession(name: string): boolean {
  try {
    dockerExec(name, ['tmux', 'has-session', '-t', sessionName(name)]);
    return true;
  } catch {
    return false;
  }
}
