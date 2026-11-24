import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'

/** Server-render an element to its HTML, for render tests. */
export async function renderToString(element: ReactElement): Promise<string> {
  const reader = (await renderToReadableStream(element)).getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

/** A button's text pattern; React's server output puts a comment marker between text and an inserted value. */
export const textOf = (text: string) => text.replace(/ (\d+)$/u, ' (?:<!-- -->)?$1')
