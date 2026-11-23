// First-principles tokenizers for Small Minds:
// 1. CharTokenizer: fixed 98-token printable ASCII + control vocabulary used by
//    the live WebGPU micro-LLM (fast, compact, zero OOV on English/code/chat).
// 2. BpeTrainer: educational Byte-Pair Encoding learner for Part 1's live merge tree.

export const BOS_ID = 0;
export const EOS_ID = 1;
export const NL_ID = 2;
export const FIRST_PRINTABLE = 3; // maps ASCII 32..126 -> ids 3..97
export const VOCAB_SIZE = 98;

export function encodeText(text: string, addBos = false): Uint32Array {
  const out: number[] = [];
  if (addBos) out.push(BOS_ID);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      out.push(NL_ID);
    } else if (code >= 32 && code <= 126) {
      out.push(FIRST_PRINTABLE + (code - 32));
    } else if (code === 9) {
      out.push(FIRST_PRINTABLE); // tab -> space
    } else if (code === 8217 || code === 8216) {
      out.push(FIRST_PRINTABLE + (39 - 32)); // curly apostrophe -> '
    } else if (code === 8220 || code === 8221) {
      out.push(FIRST_PRINTABLE + (34 - 32)); // curly quote -> "
    } else if (code === 8212 || code === 8211) {
      out.push(FIRST_PRINTABLE + (45 - 32)); // dash -> -
    }
  }
  return new Uint32Array(out);
}

export function decodeTokens(ids: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === BOS_ID || id === EOS_ID) continue;
    if (id === NL_ID) s += "\n";
    else if (id >= FIRST_PRINTABLE && id < VOCAB_SIZE) {
      s += String.fromCharCode(32 + (id - FIRST_PRINTABLE));
    }
  }
  return s;
}

export function tokenLabel(id: number): string {
  if (id === BOS_ID) return "<bos>";
  if (id === EOS_ID) return "<eos>";
  if (id === NL_ID) return "\\n";
  const ch = String.fromCharCode(32 + (id - FIRST_PRINTABLE));
  return ch === " " ? "␣" : ch;
}

// ---- Educational Byte-Pair Encoding (BPE) for Part 1 -----------------------

export interface BpeMerge {
  left: string;
  right: string;
  merged: string;
  count: number;
  newId: number;
}

export interface BpeState {
  tokens: string[];
  merges: BpeMerge[];
  vocab: string[];
  compressionRatio: number;
}

export function runBpe(text: string, numMerges: number): BpeState {
  const clean = text.replace(/\r/g, "");
  let tokens = [...clean].map((c) => (c === " " ? "·" : c === "\n" ? "↵" : c));
  const initialLen = Math.max(1, tokens.length);
  const vocabSet = new Set(tokens);
  const merges: BpeMerge[] = [];

  for (let m = 0; m < numMerges; m++) {
    const counts = new Map<string, number>();
    let bestKey = "";
    let bestCount = 1;
    for (let i = 0; i < tokens.length - 1; i++) {
      const key = `${tokens[i]}\u0000${tokens[i + 1]}`;
      const c = (counts.get(key) ?? 0) + 1;
      counts.set(key, c);
      if (c > bestCount) {
        bestCount = c;
        bestKey = key;
      }
    }
    if (!bestKey || bestCount < 2) break;
    const [left, right] = bestKey.split("\u0000");
    const merged = left + right;
    vocabSet.add(merged);
    merges.push({ left, right, merged, count: bestCount, newId: 256 + m });

    const next: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (i < tokens.length - 1 && tokens[i] === left && tokens[i + 1] === right) {
        next.push(merged);
        i++;
      } else {
        next.push(tokens[i]);
      }
    }
    tokens = next;
  }

  return {
    tokens,
    merges,
    vocab: [...vocabSet],
    compressionRatio: initialLen / Math.max(1, tokens.length),
  };
}
