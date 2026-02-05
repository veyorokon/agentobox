import {execFileSync} from 'node:child_process';
import {DOCKER_IMAGE, TMUX_PREFIX, ABOX_NETWORK, AGENTO_HOSTNAME, SERVER_PORT} from '../types.js';

function containerName(name: string): string {
  return `${TMUX_PREFIX}-${name}`;
}

/** Strip secrets from error messages before they propagate */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/ANTHROPIC_API_KEY=\S+/g, 'ANTHROPIC_API_KEY=***')
    .replace(/CLAUDE_CODE_OAUTH_TOKEN=\S+/g, 'CLAUDE_CODE_OAUTH_TOKEN=***');
}

export function dockerRun(name: string, vncPort: number, authEnvs: string[][] = []): string {
  // Remove any existing stopped container with the same name
  try {
    execFileSync('docker', ['rm', '-f', containerName(name)], {encoding: 'utf-8'});
  } catch {
    // No existing container — fine
  }

  try {
    const result = execFileSync('docker', [
      'run', '-d',
      '--platform', 'linux/amd64',
      '--name', containerName(name),
      '--network', ABOX_NETWORK,
      '--shm-size', '512m',
      '-p', `${vncPort}:6901`,
      '-e', 'KASM_IP_BLACKLIST=off',
      '-e', 'VNC_PW=password',
      '-e', 'VNC_RESOLUTION=1920x1080',
      '-e', `ABOX_AGENT_NAME=${name}`,
      '-e', `ABOX_CALLBACK_URL=http://${AGENTO_HOSTNAME}:${SERVER_PORT}/event`,
      ...authEnvs.flat(),
      DOCKER_IMAGE,
    ], {encoding: 'utf-8'});
    return result.trim();
  } catch (err) {
    throw new Error(sanitizeError(err));
  }
}

export function dockerExec(name: string, args: string[], user = 'kasm-user'): string {
  return execFileSync('docker', [
    'exec', '-u', user, containerName(name), ...args,
  ], {encoding: 'utf-8'});
}

export function dockerCp(name: string, content: string, destPath: string): void {
  execFileSync('docker', [
    'exec', '-i', containerName(name), 'bash', '-c', `cat > ${destPath}`,
  ], {encoding: 'utf-8', input: content});
}

/** List running abox-* containers and parse their metadata */
export function dockerListAbox(): Array<{name: string; containerId: string; vncPort: number; status: string; createdAt: number}> {
  try {
    const output = execFileSync('docker', [
      'ps', '-a',
      '--filter', `name=${TMUX_PREFIX}-`,
      '--format', '{{.ID}}\t{{.Names}}\t{{.Ports}}\t{{.Status}}\t{{.CreatedAt}}',
    ], {encoding: 'utf-8'}).trim();

    if (!output) return [];

    return output.split('\n').map(line => {
      const [containerId, containerNameStr, ports, status, createdAt] = line.split('\t');
      const agentName = containerNameStr.replace(`${TMUX_PREFIX}-`, '');

      const vncMatch = ports.match(/(\d+)->6901/);
      const vncPort = vncMatch ? parseInt(vncMatch[1], 10) : 0;

      return {
        name: agentName,
        containerId,
        vncPort,
        status: status.startsWith('Up') ? 'running' : 'dead',
        createdAt: new Date(createdAt).getTime() || Date.now(),
      };
    });
  } catch {
    return [];
  }
}

export function dockerStop(name: string): void {
  try {
    execFileSync('docker', ['stop', containerName(name)], {encoding: 'utf-8', timeout: 15000});
  } catch {
    // Container may already be stopped
  }
}

export function dockerRm(name: string): void {
  try {
    execFileSync('docker', ['rm', '-f', containerName(name)], {encoding: 'utf-8'});
  } catch {
    // Container may already be removed
  }
}
