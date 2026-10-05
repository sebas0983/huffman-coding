# huffman-coding

A small, dependency-free TypeScript library that builds canonical Huffman codes from text and round-trips strings through encode/decode.

```js
import { encode, decode } from 'huffman-coding';

const { bits, lengths } = encode('the quick brown fox');
const original = decode(bits, lengths);
// original === 'the quick brown fox'
```

## Why this exists

The point is variable-length prefix coding driven by observed character frequency: common symbols get short bit strings, rare ones get long ones, and no codeword is a prefix of another so decoding is unambiguous. This implementation uses **canonical codes** — only the per-symbol code lengths travel with the payload, not the tree shape — which keeps the header small and makes the decoder trivial.

The trade-off: this is a pure bit-string encoder, not a byte-packed archive. It exists for teaching and for cases where you want the compressed bit stream as a JavaScript string. If you need a real-world compressor producing packed bytes, use a production library.

## Edge cases you will hit

- **Empty string**: `encode('')` returns `{ bits: '', lengths: {} }` and decoding that yields `''`.
- **Single distinct symbol** (e.g. `"aaaa"`): the lone symbol is assigned code length 1 and encoded as one `0` bit per occurrence. A true Huffman tree would give it length 0, but then the encoder would have nothing to emit and the decoder would have no way to count occurrences from the bit stream. Length 1 keeps the round-trip well-defined.
- **Determinism**: ties in symbol frequency are broken by first-seen order so the length table is reproducible across runs and engines.

## Exports

- `frequencies(text)` → `{ [symbol]: count }`
- `codeLengths(text)` → `{ [symbol]: bitLength }`
- `canonicalCodes(lengths)` → `{ codes: { [symbol]: bitString }, symbols: string[] }`
- `encode(text)` → `{ bits: string, lengths: { [symbol]: bitLength } }`
- `decode(bits, lengths)` → `string`

## Running the tests

```
node --test
```
