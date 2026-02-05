import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {DOCKER_IMAGE, TMUX_PREFIX, ABOX_NETWORK, AGENTO_HOSTNAME, SERVER_PORT} from '../types.js';
import {withSpan} from '../telemetry.js';
import {dockerLog} from '../logger.js';

const execFile = promisify(execFileCb);

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

export async function dockerRun(name: string, vncPort: number, authEnvs: string[][] = []): Promise<string> {
  return withSpan('docker.run', {'docker.container': name, 'docker.port': vncPort, 'docker.image': DOCKER_IMAGE}, async (span) => {
    // Remove any existing stopped container with the same name
    try {
      await execFile('docker', ['rm', '-f', containerName(name)]);
    } catch {
      // No existing container — fine
    }

    try {
      const {stdout} = await execFile('docker', [
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
        '-e', `ABOX_CALLBACK_URL=http://${AGENTO_HOSTNAME}:${SERVER_PORT}/api/v1/event`,
        ...authEnvs.flat(),
        DOCKER_IMAGE,
      ]);
      const containerId = stdout.trim();
      span.setAttribute('docker.container_id', containerId.slice(0, 12));
      return containerId;
    } catch (err) {
      throw new Error(sanitizeError(err));
    }
  });
}

export async function dockerExec(name: string, args: string[], user = 'kasm-user'): Promise<string> {
  return withSpan('docker.exec', {'docker.container': name, 'docker.command': args[0] ?? ''}, async () => {
    const {stdout} = await execFile('docker', [
      'exec', '-u', user, containerName(name), ...args,
    ]);
    return stdout;
  });
}

export async function dockerCp(name: string, content: string, destPath: string): Promise<void> {
  return withSpan('docker.cp', {'docker.container': name, 'docker.dest': destPath}, async () => {
    const b64 = Buffer.from(content).toString('base64');
    await execFile('docker', [
      'exec', containerName(name), 'bash', '-c',
      `echo '${b64}' | base64 -d > ${destPath}`,
    ], {timeout: 15000});
  });
}

/** List running abox-* containers and parse their metadata */
export async function dockerListAbox(): Promise<Array<{name: string; containerId: string; vncPort: number; status: string; createdAt: number}>> {
  return withSpan('docker.list', {}, async (span) => {
    try {
      const {stdout} = await execFile('docker', [
        'ps', '-a',
        '--filter', `name=${TMUX_PREFIX}-`,
        '--format', '{{.ID}}\t{{.Names}}\t{{.Ports}}\t{{.Status}}\t{{.CreatedAt}}',
      ]);

      const output = stdout.trim();
      if (!output) {
        span.setAttribute('docker.count', 0);
        return [];
      }

      const results = output.split('\n').map(line => {
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

      span.setAttribute('docker.count', results.length);
      return results;
    } catch (err) {
      dockerLog.warn({err}, 'Failed to list containers');
      span.setAttribute('docker.count', 0);
      return [];
    }
  });
}

export async function dockerStop(name: string): Promise<void> {
  return withSpan('docker.stop', {'docker.container': name}, async () => {
    try {
      await execFile('docker', ['stop', containerName(name)], {timeout: 15000});
    } catch {
      // Container may already be stopped
    }
  });
}

export async function dockerRm(name: string): Promise<void> {
  return withSpan('docker.rm', {'docker.container': name}, async () => {
    try {
      await execFile('docker', ['rm', '-f', containerName(name)]);
    } catch {
      // Container may already be removed
    }
  });
}
