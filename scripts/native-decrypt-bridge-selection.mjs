import fs from 'node:fs';
import path from 'node:path';

export const NATIVE_DECRYPT_BRIDGE_CONSUMER = 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/NativeOrdinaryClientDecryptionTests.swift';
const descriptor = 'lib/chatgpt-product/fixtures/native-client-decrypt-swift-bridge.json';
const expected = Object.freeze({ version: 1, entrypoint: 'lib/chatgpt-product/fixtures/native-client-decrypt-swift-bridge.cjs',
  nodeMajor: 24, executableEnvironment: 'MEDIFLOW_NODE24', fallbackExecutable: '/usr/bin/env', fallbackArguments: ['node'],
  protocol: 'json-lines', lineTerminator: 10, maxLineBytes: 4194304 });

// Lexical binding only: preserve quoted literals, discard comments/spacing. No Swift or bridge execution.
function compact(source) {
  return (source.match(/#+"""[\s\S]*?"""#+|#+"[^\n]*?"#+|"""[\s\S]*?"""|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[^\s]/g) ?? [])
    .filter(token => !token.startsWith('//') && !token.startsWith('/*'));
}
function requireOnce(source, snippet) {
  const value = compact(snippet);
  const count = source.filter((_, index) => value.every((token, offset) => source[index + offset] === token)).length;
  if (count !== 1) throw new Error(`Native decrypt bridge binding missing or duplicated: ${snippet}`);
}

export function collectNativeDecryptBridgeSelection(root) {
  try {
    const contract = JSON.parse(fs.readFileSync(path.join(root, descriptor), 'utf8'));
    if (JSON.stringify(Object.keys(contract).sort()) !== JSON.stringify(Object.keys(expected).sort())
      || Object.entries(expected).some(([key, value]) => JSON.stringify(contract[key]) !== JSON.stringify(value)))
      throw new Error('Native decrypt bridge descriptor differs from the reviewed invocation/protocol');
    const swift = compact(fs.readFileSync(path.join(root, NATIVE_DECRYPT_BRIDGE_CONSUMER), 'utf8'));
    for (const snippet of [
      `let contractFile = root.appendingPathComponent("${descriptor}")`,
      'let contract = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: contractFile)) as? [String: Any])',
      'let file = root.appendingPathComponent(try XCTUnwrap(contract["entrypoint"] as? String))',
      'let executableEnvironment = try XCTUnwrap(contract["executableEnvironment"] as? String)',
      'let fallbackExecutable = try XCTUnwrap(contract["fallbackExecutable"] as? String)',
      'let fallbackArguments = try XCTUnwrap(contract["fallbackArguments"] as? [String])',
      'process.executableURL = URL(fileURLWithPath: environment[executableEnvironment] ?? fallbackExecutable)',
      'process.arguments = (environment[executableEnvironment] == nil ? fallbackArguments : []) + [file.path]',
      'process.currentDirectoryURL = root; process.standardInput = input; process.standardOutput = output',
      'try process.run()',
      'lineTerminator = UInt8(try XCTUnwrap(contract["lineTerminator"] as? Int))',
      'maxLineBytes = try XCTUnwrap(contract["maxLineBytes"] as? Int)',
      'var data = try JSONSerialization.data(withJSONObject: object); data.append(lineTerminator)',
      'try input.fileHandleForWriting.write(contentsOf: data)',
      'while line.count <= maxLineBytes',
      'if byte[0] == lineTerminator { break }; line.append(byte)',
    ]) requireOnce(swift, snippet);
    const bridge = compact(fs.readFileSync(path.join(root, contract.entrypoint), 'utf8'));
    for (const snippet of [
      "const contract=require('./native-client-decrypt-swift-bridge.json')",
      "assert.equal(contract.protocol,'json-lines');assert.equal(contract.lineTerminator,10);assert.equal(contract.maxLineBytes,4*1024*1024)",
      "createInterface({input:process.stdin,crlfDelay:Infinity})",
      'assert.ok(line.length<=contract.maxLineBytes)',
      'run(JSON.parse(line))',
      "process.stdout.write(JSON.stringify({ok:true,result})+'\\n')",
    ]) requireOnce(bridge, snippet);
    return { files: [contract.entrypoint], errors: [], mode: 'child', binding: {
      consumer: NATIVE_DECRYPT_BRIDGE_CONSUMER, invocationVerified: true, conditional: true,
      descriptor, runtime: 'Node 24', protocol: 'json-lines', execution: 'NOT_ASSESSED',
    } };
  } catch (error) {
    return { files: [], errors: [error.message], mode: 'child', binding: null };
  }
}
