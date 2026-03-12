import { Key } from '@nut-tree-fork/nut-js';
export declare class InvalidKeyError extends Error {
    constructor(key: string);
}
export declare const toKeys: (xdotoolString: string) => Key[];
