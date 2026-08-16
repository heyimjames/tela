import { describe, expect, it } from 'vitest'
import { posix, win32 } from 'node:path'

import { defaultApprovedRootFor } from '../../src/mcp/paths'

describe('Pyrito Design default approved root', () => {
  it('uses the new macOS root without retaining the former Clickt path', () => {
    const root = defaultApprovedRootFor('darwin', '/Users/operator')

    expect(root).toBe(posix.join('/Users/operator', 'Library', 'Application Support', 'Pyrito', 'Design'))
    expect(root).not.toContain('Clickt')
    expect(root).not.toContain('AdStudio')
  })

  it('uses LOCALAPPDATA on Windows', () => {
    const root = defaultApprovedRootFor('win32', 'C:\\Users\\operator', 'D:\\Profiles\\Local')

    expect(win32.normalize(root)).toBe(win32.join('D:\\Profiles\\Local', 'Pyrito', 'Design'))
    expect(root).not.toContain('Clickt')
    expect(root).not.toContain('AdStudio')
  })

  it('falls back to the Windows profile when LOCALAPPDATA is unavailable', () => {
    const root = defaultApprovedRootFor('win32', 'C:\\Users\\operator')

    expect(win32.normalize(root)).toBe(win32.join('C:\\Users\\operator', 'AppData', 'Local', 'Pyrito', 'Design'))
  })
})
