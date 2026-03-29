/**
 * Binary embedding index for obsidian-memory v2.
 *
 * Format:
 *   Header (12 bytes): version(u32) + count(u32) + dimension(u32)
 *   Path index (variable): per entry: path_len(u16) + path_bytes(utf8) + content_hash(16 bytes)
 *   Vector block: count × dimension × 4 bytes (contiguous Float32Array)
 *
 * At <10K documents, brute-force cosine similarity over a contiguous Float32Array
 * is functionally equivalent to FAISS without IVF training overhead.
 */

import { createHash } from "crypto";
import type { BinEmbeddingIndex, VectorResult } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORMAT_VERSION = 1;
const HASH_BYTES = 16;
const HEADER_BYTES = 12; // 3 × u32

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

export function contentHash(text: string): Uint8Array {
  const full = createHash("sha256").update(text).digest();
  return new Uint8Array(full.buffer, full.byteOffset, HASH_BYTES);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function writeEmbeddingsBin(
  entries: Array<{ key: string; contentHash: Uint8Array; vector: Float32Array }>,
  dimension: number,
): Uint8Array {
  if (entries.length === 0) {
    // Write header-only file
    const buf = new ArrayBuffer(HEADER_BYTES);
    const view = new DataView(buf);
    view.setUint32(0, FORMAT_VERSION, true);
    view.setUint32(4, 0, true);
    view.setUint32(8, dimension, true);
    return new Uint8Array(buf);
  }

  // Calculate total size
  let pathIndexSize = 0;
  const encodedKeys: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const encoded = encoder.encode(entry.key);
    encodedKeys.push(encoded);
    pathIndexSize += 2 + encoded.byteLength + HASH_BYTES; // u16 len + bytes + hash
  }

  // Pad path index to 4-byte alignment for Float32Array
  const rawPathEnd = HEADER_BYTES + pathIndexSize;
  const padding = (4 - (rawPathEnd % 4)) % 4;
  const vectorBlockSize = entries.length * dimension * 4;
  const totalSize = rawPathEnd + padding + vectorBlockSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Header
  view.setUint32(0, FORMAT_VERSION, true);
  view.setUint32(4, entries.length, true);
  view.setUint32(8, dimension, true);

  // Path index
  let offset = HEADER_BYTES;
  for (let i = 0; i < entries.length; i++) {
    const keyBytes = encodedKeys[i];
    view.setUint16(offset, keyBytes.byteLength, true);
    offset += 2;
    bytes.set(keyBytes, offset);
    offset += keyBytes.byteLength;
    bytes.set(entries[i].contentHash, offset);
    offset += HASH_BYTES;
  }

  // Align to 4-byte boundary
  offset += padding;

  // Vector block
  const vectors = new Float32Array(buf, offset, entries.length * dimension);
  for (let i = 0; i < entries.length; i++) {
    vectors.set(entries[i].vector, i * dimension);
  }

  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function readEmbeddingsBin(data: Uint8Array): BinEmbeddingIndex {
  if (data.byteLength < HEADER_BYTES) {
    throw new Error("Invalid embeddings file: too small for header");
  }

  // Copy into an aligned ArrayBuffer for DataView access
  const aligned = new ArrayBuffer(data.byteLength);
  new Uint8Array(aligned).set(data);
  const view = new DataView(aligned);

  const version = view.getUint32(0, true);
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported embeddings format version: ${version}`);
  }

  const count = view.getUint32(4, true);
  const dimension = view.getUint32(8, true);

  const entries = new Map<string, number>();
  const hashes = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();

  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const pathLen = view.getUint16(offset, true);
    offset += 2;
    const keyBytes = new Uint8Array(aligned, offset, pathLen);
    const key = decoder.decode(keyBytes);
    offset += pathLen;
    const hash = new Uint8Array(aligned, offset, HASH_BYTES);
    hashes.set(key, new Uint8Array(hash)); // copy to avoid aliasing
    offset += HASH_BYTES;
    entries.set(key, i);
  }

  // Align to 4-byte boundary (matching write padding)
  const padding = (4 - (offset % 4)) % 4;
  offset += padding;

  // Vector block — create a Float32Array view over the remaining data
  const vectors = new Float32Array(aligned, offset, count * dimension);

  return { version, count, dimension, entries, hashes, vectors };
}

// ---------------------------------------------------------------------------
// Load from file (graceful null)
// ---------------------------------------------------------------------------

export async function loadEmbeddingsFile(
  path: string,
): Promise<BinEmbeddingIndex | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;

  const data = new Uint8Array(await file.arrayBuffer());
  if (data.byteLength === 0) return null;

  return readEmbeddingsBin(data);
}

export async function saveEmbeddingsFile(
  path: string,
  index: BinEmbeddingIndex,
): Promise<void> {
  // Reconstruct entries for serialization
  const entriesArray: Array<{
    key: string;
    contentHash: Uint8Array;
    vector: Float32Array;
  }> = [];

  for (const [key, vecIdx] of index.entries) {
    const hash = index.hashes.get(key);
    if (!hash) continue;
    const start = vecIdx * index.dimension;
    const vector = index.vectors.slice(start, start + index.dimension);
    entriesArray.push({ key, contentHash: hash, vector });
  }

  const bin = writeEmbeddingsBin(entriesArray, index.dimension);
  await Bun.write(path, bin);
}

// ---------------------------------------------------------------------------
// Add / Remove entries
// ---------------------------------------------------------------------------

export function addEntry(
  index: BinEmbeddingIndex,
  key: string,
  hash: Uint8Array,
  vector: Float32Array,
): BinEmbeddingIndex {
  // Rebuild entries list with the new/updated entry
  const allEntries: Array<{
    key: string;
    contentHash: Uint8Array;
    vector: Float32Array;
  }> = [];

  for (const [k, vecIdx] of index.entries) {
    if (k === key) continue; // skip old version if updating
    const h = index.hashes.get(k)!;
    const start = vecIdx * index.dimension;
    const v = index.vectors.slice(start, start + index.dimension);
    allEntries.push({ key: k, contentHash: h, vector: v });
  }

  allEntries.push({ key, contentHash: hash, vector });

  // Rebuild index
  const newEntries = new Map<string, number>();
  const newHashes = new Map<string, Uint8Array>();
  const newVectors = new Float32Array(allEntries.length * index.dimension);

  for (let i = 0; i < allEntries.length; i++) {
    const e = allEntries[i];
    newEntries.set(e.key, i);
    newHashes.set(e.key, e.contentHash);
    newVectors.set(e.vector, i * index.dimension);
  }

  return {
    version: index.version,
    count: allEntries.length,
    dimension: index.dimension,
    entries: newEntries,
    hashes: newHashes,
    vectors: newVectors,
  };
}

export function removeEntry(
  index: BinEmbeddingIndex,
  key: string,
): BinEmbeddingIndex {
  if (!index.entries.has(key)) return index;

  const allEntries: Array<{
    key: string;
    contentHash: Uint8Array;
    vector: Float32Array;
  }> = [];

  for (const [k, vecIdx] of index.entries) {
    if (k === key) continue;
    const h = index.hashes.get(k)!;
    const start = vecIdx * index.dimension;
    const v = index.vectors.slice(start, start + index.dimension);
    allEntries.push({ key: k, contentHash: h, vector: v });
  }

  const newEntries = new Map<string, number>();
  const newHashes = new Map<string, Uint8Array>();
  const newVectors = new Float32Array(allEntries.length * index.dimension);

  for (let i = 0; i < allEntries.length; i++) {
    const e = allEntries[i];
    newEntries.set(e.key, i);
    newHashes.set(e.key, e.contentHash);
    newVectors.set(e.vector, i * index.dimension);
  }

  return {
    version: index.version,
    count: allEntries.length,
    dimension: index.dimension,
    entries: newEntries,
    hashes: newHashes,
    vectors: newVectors,
  };
}

// ---------------------------------------------------------------------------
// Create empty index
// ---------------------------------------------------------------------------

export function emptyIndex(dimension: number = 768): BinEmbeddingIndex {
  return {
    version: FORMAT_VERSION,
    count: 0,
    dimension,
    entries: new Map(),
    hashes: new Map(),
    vectors: new Float32Array(0),
  };
}

// ---------------------------------------------------------------------------
// Search (brute-force cosine similarity)
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function searchEmbeddings(
  index: BinEmbeddingIndex,
  queryVector: Float32Array,
  topK: number = 10,
): VectorResult[] {
  if (index.count === 0) return [];

  const results: VectorResult[] = [];

  for (const [key, vecIdx] of index.entries) {
    const start = vecIdx * index.dimension;
    const entryVec = index.vectors.subarray(start, start + index.dimension);
    const score = cosineSimilarity(queryVector, entryVec);
    results.push({ id: key, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
