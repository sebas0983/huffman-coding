import { test } from 'node:test';
import assert from 'node:assert/strict';

import { frequencies, codeLengths, canonicalCodes, encode, decode } from '../src/index.js';

test('frequencies counts each character', () => {
  const f = frequencies('aabbbc');
  assert.deepEqual(f, { a: 2, b: 3, c: 1 });
});

test('frequencies on empty string yields empty object', () => {
  assert.deepEqual(frequencies(''), {});
});

test('codeLengths assigns shorter codes to more frequent symbols', () => {
  // 'b' is most frequent, so it must get a code no longer than 'c' (least frequent).
  const lens = codeLengths('aabbbc');
  assert.ok(lens.b <= lens.c, `b (${lens.b}) should be <= c (${lens.c})`);
  assert.ok(lens.a <= lens.c, `a (${lens.a}) should be <= c (${lens.c})`);
});

test('codeLengths is deterministic across calls', () => {
  const a = codeLengths('the quick brown fox jumps over the lazy dog');
  const b = codeLengths('the quick brown fox jumps over the lazy dog');
  assert.deepEqual(a, b);
});

test('codeLengths on single symbol returns length 1', () => {
  // The encoder must emit a concrete bit per occurrence, so length 1 (not 0).
  assert.deepEqual(codeLengths('aaaa'), { a: 1 });
});

test('canonicalCodes produces prefix-free codes', () => {
  const lens = codeLengths('mississippi');
  const { codes } = canonicalCodes(lens);
  const codewords = Object.values(codes);
  for (let i = 0; i < codewords.length; i++) {
    for (let j = 0; j < codewords.length; j++) {
      if (i === j) continue;
      assert.ok(!codewords[i].startsWith(codewords[j]),
        `${codewords[i]} must not start with ${codewords[j]}`);
    }
  }
});

test('canonicalCodes on empty length table yields empty result', () => {
  const { codes, symbols } = canonicalCodes({});
  assert.deepEqual(codes, {});
  assert.deepEqual(symbols, []);
});

test('encode then decode round-trips a typical string', () => {
  const text = 'hello huffman';
  const { bits, lengths } = encode(text);
  assert.equal(decode(bits, lengths), text);
});

test('encoded output is at least as long as symbol-count times min code length', () => {
  // Sanity: every input symbol contributes at least one bit unless empty.
  const text = 'aabbbc';
  const { bits } = encode(text);
  assert.ok(bits.length >= text.length, `bits.length (${bits.length}) < text.length (${text.length})`);
});

test('round-trip on empty input', () => {
  const { bits, lengths } = encode('');
  assert.equal(bits, '');
  assert.deepEqual(lengths, {});
  assert.equal(decode(bits, lengths), '');
});

test('round-trip on single repeated symbol', () => {
  const { bits, lengths } = encode('zzzzz');
  assert.equal(bits, '00000');
  assert.deepEqual(lengths, { z: 1 });
  assert.equal(decode(bits, lengths), 'zzzzz');
});

test('round-trip preserves non-ASCII characters', () => {
  const text = 'café résumé — 日本語';
  const { bits, lengths } = encode(text);
  assert.equal(decode(bits, lengths), text);
});

test('decode rejects trailing partial bits', () => {
  const { bits } = encode('hello');
  // Chop the last bit so a codeword is incomplete.
  const truncated = bits.slice(0, bits.length - 1);
  assert.throws(() => decode(truncated, codeLengths('hello')));
});

test('decode rejects bits when length table is empty', () => {
  assert.throws(() => decode('0', {}));
});
