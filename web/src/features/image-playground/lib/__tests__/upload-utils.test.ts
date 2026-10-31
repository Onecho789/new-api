/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_UPLOAD_SIZE_BYTES } from '../../constants'
import { acceptUploadFiles, formatFileSize } from '../upload-utils'

function makeFile(name: string, type: string, size = 1024): File {
  const file = new File(['x'], name, { type })
  // File 的 size 由内容决定，测试里需要伪造超限体积
  Object.defineProperty(file, 'size', { value: size })
  return file
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  })
})

describe('acceptUploadFiles', () => {
  it('accepts supported image types', () => {
    const result = acceptUploadFiles([
      makeFile('a.png', 'image/png'),
      makeFile('b.jpg', 'image/jpeg'),
      makeFile('c.webp', 'image/webp'),
    ])

    expect(result.accepted).toHaveLength(3)
    expect(result.rejected).toEqual([])
  })

  it('rejects unsupported types and oversized files', () => {
    const result = acceptUploadFiles([
      makeFile('a.gif', 'image/gif'),
      makeFile('b.png', 'image/png', MAX_UPLOAD_SIZE_BYTES + 1),
    ])

    expect(result.accepted).toEqual([])
    expect(result.rejected).toEqual([
      { fileName: 'a.gif', kind: 'type' },
      { fileName: 'b.png', kind: 'size' },
    ])
  })

  it('stops at the count limit and counts existing images', () => {
    const result = acceptUploadFiles(
      [makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')],
      1,
      2
    )

    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toEqual([{ kind: 'count', limit: 2 }])
  })
})

describe('formatFileSize', () => {
  it('scales units by magnitude', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
