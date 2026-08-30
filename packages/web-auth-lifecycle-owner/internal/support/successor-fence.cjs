/* @Codex */
'use strict';
const { randomBytes } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { Buffer } = require('node:buffer');
const bufferIsBuffer = Buffer.isBuffer;
const bufferPrototype = Buffer.prototype;
const bufferToString = bufferPrototype.toString;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectApply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;
function successorFence() {
    try {
        const bytes = randomBytes(32);
        if (isProxy(bytes) || !bufferIsBuffer(bytes) || objectGetPrototypeOf(bytes) !== bufferPrototype) return null;
        const value = reflectApply(bufferToString, bytes, ['hex']);
        if (typeof value !== 'string' || value.length !== 64) return null;
        for (let index = 0; index < value.length; index += 1) {
            const code = reflectApply(stringCharCodeAt, value, [index]);
            if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return null;
        }
        return value;
    } catch {
        return null;
    }
}
module.exports = objectFreeze({ successorFence });
