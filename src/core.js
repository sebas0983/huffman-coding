/**
 * Core Huffman coding implementation.
 *
 * Canonical code assignment: after building a frequency-driven tree, we emit
 * codes whose length equals the tree depth for each symbol, but assign the
 * actual bit patterns canonically (shorter lengths first, then by symbol
 * value within a length). This keeps encoder and decoder in sync without
 * embedding the tree shape in the stream — only the per-symbol code lengths
 * travel with the payload. A length of 0 is reserved for the single-symbol
 * case so the decoder has a well-defined representation for every input.
 */

/**
 * Priority-queue node used during tree construction.
 *
 * The `order` counter breaks frequency ties deterministically: symbols that
 * appear earlier in the input (and thus entered the queue earlier) sort
 * earlier. Without it, two builds over equal-frequency inputs could produce
 * different tree shapes depending on JS engine sort stability, which would
 * break byte-for-byte reproducibility of the encoded output.
 */
function makeNode(symbol, count, order, left, right) {
  return { symbol, count, order, left, right };
}

/**
 * Compute a frequency map over the input string.
 *
 * Uses a plain object keyed by the character. We intentionally do not use a
 * Map here because the canonical-length phase later needs to sort symbols, and
 * Object keys over single-character strings give us exactly the iterable set
 * we need with no extra ceremony.
 */
export function frequencies(text) {
  const freq = {};
  for (const ch of text) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  return freq;
}

/**
 * Build code lengths for every distinct symbol.
 *
 * Returns an object mapping symbol -> bit length. For the degenerate
 * single-symbol input, that symbol gets length 1 (not 0) so the encoder can
 * emit a concrete bit and the decoder can consume one; the length table itself
 * still records 1 rather than the usual 0 sentinel for single-symbol cases so
 * round-tripping survives inputs like "aaaa".
 */
export function codeLengths(text) {
  const freq = frequencies(text);
  const symbols = Object.keys(freq);

  if (symbols.length === 0) {
    return {};
  }

  if (symbols.length === 1) {
    const only = symbols[0];
    return { [only]: 1 };
  }

  // Build a Huffman tree via a simple ordered array used as a priority queue.
  // For the symbol counts typical of text compression, the O(n^2) pop cost is
  // negligible and avoids any dependency on a heap implementation.
  let order = 0;
  const queue = symbols.map((sym) => makeNode(sym, freq[sym], order++, null, null));

  while (queue.length > 1) {
    // Stable sort by (count, order): ties resolved by insertion order.
    queue.sort((a, b) => a.count - b.count || a.order - b.order);
    const a = queue.shift();
    const b = queue.shift();
    const parent = makeNode(null, a.count + b.count, order++, a, b);
    queue.push(parent);
  }

  const root = queue[0];
  const lengths = {};

  // Iterative DFS so we do not risk stack overflow on pathological inputs with
  // deeply skewed trees (e.g. all distinct frequencies yielding a comb tree).
  const stack = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (node.symbol !== null) {
      lengths[node.symbol] = depth;
    } else {
      stack.push({ node: node.left, depth: depth + 1 });
      stack.push({ node: node.right, depth: depth + 1 });
    }
  }

  return lengths;
}

/**
 * Produce canonical codes from a length table.
 *
 * Given each symbol's bit length, assign concrete codewords by the canonical
 * scheme: sort symbols by (length, symbol), then increment a running code,
 * left-shifting whenever the length increases. This is what the decoder
 * reverses, so the exact same table on the decoder side reproduces identical
 * codewords.
 *
 * Returns { codes, symbols } where `codes` maps symbol -> binary string and
 * `symbols` is the canonical ordering used during decoding.
 */
export function canonicalCodes(lengths) {
  const symbols = Object.keys(lengths).filter((s) => lengths[s] > 0);
  if (symbols.length === 0) {
    return { codes: {}, symbols: [] };
  }

  symbols.sort((a, b) => lengths[a] - lengths[b] || (a < b ? -1 : a > b ? 1 : 0));

  const codes = {};
  let code = 0;
  let prevLen = symbols[0] ? lengths[symbols[0]] : 0;

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const len = lengths[sym];
    if (i === 0) {
      code = 0;
    } else {
      code = (code + 1) << (len - prevLen);
    }
    codes[sym] = code.toString(2).padStart(len, '0');
    prevLen = len;
  }

  return { codes, symbols };
}

/**
 * Encode `text` into a Huffman-coded bit string.
 *
 * Returns { bits, lengths } where `lengths` is the canonical length table the
 * decoder needs to reconstruct the codes. Empty input yields an empty bit
 * string and an empty table.
 */
export function encode(text) {
  if (text.length === 0) {
    return { bits: '', lengths: {} };
  }

  const lengths = codeLengths(text);
  const { codes } = canonicalCodes(lengths);

  let bits = '';
  for (const ch of text) {
    bits += codes[ch];
  }

  return { bits, lengths };
}

/**
 * Decode a Huffman-coded bit string back to text.
 *
 * `lengths` must be the table returned by `encode`. The decoder rebuilds the
 * canonical codes and walks the bit stream, matching against the symbol list
 * sorted by (length, symbol). Because canonical codes form a prefix code, the
 * first match at the current position is unambiguous.
 *
 * For single-symbol inputs the encoder emitted one bit per occurrence; the
 * canonical code for the lone symbol is "0", so we decode each '0' as that
 * symbol. Any stray '1' in that case is rejected as corruption.
 */
export function decode(bits, lengths) {
  const symbols = Object.keys(lengths).filter((s) => lengths[s] > 0);

  if (symbols.length === 0) {
    if (bits.length !== 0) {
      throw new Error('decode: bits present but length table is empty');
    }
    return '';
  }

  const { codes } = canonicalCodes(lengths);

  // Build a lookup from codeword string -> symbol. Canonical codes are unique
  // and prefix-free, so this map is safe.
  const lookup = new Map();
  for (const sym of symbols) {
    lookup.set(codes[sym], sym);
  }

  // For single-symbol input we must consume exactly one bit per symbol even
  // though the "natural" code would be the empty string. The encoder recorded
  // length 1 for that case, so codes[sym] is "0" and the loop below handles
  // it correctly without special casing.
  let out = '';
  let buffer = '';
  for (let i = 0; i < bits.length; i++) {
    buffer += bits[i];
    const sym = lookup.get(buffer);
    if (sym !== undefined) {
      out += sym;
      buffer = '';
    }
    // Defensive cap: no valid codeword exceeds the max length in the table, so
    // a buffer longer than that signals corruption rather than patience.
    if (buffer.length > 0) {
      let maxLen = 0;
      for (const s of symbols) {
        if (lengths[s] > maxLen) maxLen = lengths[s];
      }
      if (buffer.length > maxLen) {
        throw new Error('decode: bit sequence has no matching codeword');
      }
    }
  }

  if (buffer.length !== 0) {
    throw new Error('decode: trailing bits do not form a complete codeword');
  }

  return out;
}
