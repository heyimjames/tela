/**
 * The published JSON Schemas.
 *
 * `schemas/*.json` are the artifacts other tools — the MCP server, the plugin, a
 * reviewer with a validator — read to understand a `.tela` file. They are derived
 * from the zod schemas rather than written by hand, and this test is what keeps the
 * two from drifting: change the zod schema without regenerating and the suite
 * fails. Regenerate with `TELA_WRITE_SCHEMAS=1 npm test`.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { telaDocumentSchema, telaManifestSchema, DOCUMENT_SCHEMA_ID, BUNDLE_SCHEMA_ID } from './schema'

const SCHEMA_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../../schemas')

function generate(schema: z.ZodType, id: string, title: string, description: string): string {
  const jsonSchema = z.toJSONSchema(schema, { io: 'output', reused: 'ref' }) as Record<string, unknown>
  return `${JSON.stringify({ $id: id, title, description, ...jsonSchema }, null, 2)}\n`
}

const PUBLISHED = [
  {
    file: 'tela-document-v1.schema.json',
    content: generate(
      telaDocumentSchema,
      DOCUMENT_SCHEMA_ID,
      'Pyrito Design portable document, v1',
      'The complete editable Pyrito Design state stored as document.json inside a .tela compatibility bundle. Every object is closed: unknown properties are invalid, so a reader can never silently discard a field it does not recognise.',
    ),
  },
  {
    file: 'tela-manifest-v1.schema.json',
    content: generate(
      telaManifestSchema,
      BUNDLE_SCHEMA_ID,
      'Pyrito Design bundle manifest, v1',
      'The manifest.json entry of a .tela bundle. It carries format identity, producer and source commit, the document hash, the sorted asset inventory, the reader limits, migration metadata, and the semantic content revision. It deliberately carries no save-time timestamp.',
    ),
  },
]

describe('published JSON schemas', () => {
  if (process.env.TELA_WRITE_SCHEMAS === '1') {
    it('regenerates the published schemas', () => {
      if (!existsSync(SCHEMA_DIRECTORY)) mkdirSync(SCHEMA_DIRECTORY, { recursive: true })
      for (const { file, content } of PUBLISHED) writeFileSync(join(SCHEMA_DIRECTORY, file), content)
      expect(PUBLISHED.length).toBeGreaterThan(0)
    })
    return
  }

  for (const { file, content } of PUBLISHED) {
    it(`${file} matches the zod schema it is generated from`, () => {
      const committed = readFileSync(join(SCHEMA_DIRECTORY, file), 'utf8')
      expect(committed).toBe(content)
    })
  }

  it('declares closed objects, so unknown fields are invalid', () => {
    const document = JSON.parse(readFileSync(join(SCHEMA_DIRECTORY, 'tela-document-v1.schema.json'), 'utf8'))
    expect(document.additionalProperties).toBe(false)
  })

  it('publishes a manifest with no save-time field', () => {
    const manifest = JSON.parse(readFileSync(join(SCHEMA_DIRECTORY, 'tela-manifest-v1.schema.json'), 'utf8'))
    expect(Object.keys(manifest.properties)).not.toContain('savedAt')
    expect(Object.keys(manifest.properties)).toEqual(
      expect.arrayContaining(['document', 'assets', 'producer', 'migration', 'contentRevision', 'limits']),
    )
  })
})
