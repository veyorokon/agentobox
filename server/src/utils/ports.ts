import {VNC_PORT_BASE} from '../types.js';

const allocatedVncPorts = new Set<number>();

export function allocateVncPort(): number {
  let port = VNC_PORT_BASE;
  while (allocatedVncPorts.has(port)) port++;
  allocatedVncPorts.add(port);
  return port;
}

export function freeVncPort(port: number): void {
  allocatedVncPorts.delete(port);
}

export function reserveVncPort(port: number): void {
  allocatedVncPorts.add(port);
}
