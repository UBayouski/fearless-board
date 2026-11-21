import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'

/**
 * Streams a `.jsonl.zst` file one parsed line at a time, without writing the
 * decompressed data to disk (match files are 50-150x larger uncompressed).
 */
export async function* readJsonlZst(path: string): AsyncGenerator<unknown> {
  const text = createReadStream(path).pipe(createZstdDecompress())
  const lines = createInterface({ input: text, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.length > 0) yield JSON.parse(line)
  }
}
