import { registerComputer } from './computer.js';
import { registerSafari } from './safari.js';
export function registerAll(server) {
    registerComputer(server);
    registerSafari(server);
}
