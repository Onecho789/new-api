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
import { describe, expect, test } from 'vitest'

import { usageLogSchema } from '../../data/schema'
import { formatModelName } from '../format'
import {
  isResponseModelMismatch,
  type ResponseModelObservation,
} from '../response-model'

function observation(
  returned: string,
  overrides: Partial<ResponseModelObservation> = {}
): ResponseModelObservation {
  return {
    requested_model: 'requested',
    upstream_model: 'mapped',
    returned_model: returned,
    ...overrides,
  }
}

describe('isResponseModelMismatch', () => {
  test.each([
    ['requested', 'exact requested model'],
    ['mapped', 'exact upstream model'],
    ['Requested', 'case-only difference'],
    ['requested-2026-09-01', 'dated variant of the requested model'],
    ['mapped-2026-09-01', 'dated variant of the upstream model'],
    ['deepseek/requested', 'provider path in front of the requested model'],
    ['vendor/MAPPED', 'provider path with a case-only difference'],
    ['accounts/vendor/models/requested', 'nested provider path'],
  ])('treats %s as compatible (%s)', (returned) => {
    expect(isResponseModelMismatch(observation(returned))).toBe(false)
  })

  test.each([
    ['other', 'different model'],
    ['request', 'shorter name that the expected model extends'],
    ['vendor/other', 'different model behind a provider path'],
    ['vendor/request', 'provider path with a shorter name'],
    ['vendor/', 'provider path with no model segment'],
    ['vendor', 'provider segment alone'],
  ])('flags %s as a mismatch (%s)', (returned) => {
    expect(isResponseModelMismatch(observation(returned))).toBe(true)
  })

  test('compares against provider-qualified requested and upstream names as written', () => {
    expect(
      isResponseModelMismatch(
        observation('vendor/requested-2026-09-01', {
          requested_model: 'vendor/requested',
        })
      )
    ).toBe(false)
    expect(
      isResponseModelMismatch(
        observation('vendor/other', { requested_model: 'vendor/requested' })
      )
    ).toBe(true)
  })

  test('empty expected names never match', () => {
    expect(
      isResponseModelMismatch(
        observation('other', { requested_model: '', upstream_model: '' })
      )
    ).toBe(true)
  })

  test('returns false without an observation or a returned model', () => {
    expect(isResponseModelMismatch(undefined)).toBe(false)
    expect(isResponseModelMismatch(observation(''))).toBe(false)
  })

  test.each([true, false])(
    'preserves the mismatch result %s when private model names are redacted',
    (mismatch) => {
      expect(
        isResponseModelMismatch({
          requested_model: 'requested',
          upstream_model: 'requested',
          returned_model: 'requested',
          mismatch,
        })
      ).toBe(mismatch)
      expect(
        isResponseModelMismatch({
          requested_model: 'requested',
          upstream_model: '',
          returned_model: '',
          mismatch,
        })
      ).toBe(mismatch)
    }
  )

  test.each([
    ['vendor/requested', true, false],
    ['other', false, true],
  ])(
    'recomputes historical response %s instead of trusting the stored flag %s',
    (returned, stored, expected) => {
      expect(
        isResponseModelMismatch(observation(returned, { mismatch: stored }))
      ).toBe(expected)
    }
  )
})

describe('formatModelName response diagnostics', () => {
  test.each([
    { returned: 'vendor/requested', stored: true, expected: false },
    { returned: 'other', stored: false, expected: true },
    { returned: 'other', stored: undefined, expected: true },
  ])(
    'recomputes $returned before redacting private model names',
    ({ returned, stored, expected }) => {
      const log = usageLogSchema.parse({
        id: 1,
        user_id: 1,
        created_at: 1,
        type: 2,
        content: '',
        model_name: 'requested',
        other: JSON.stringify({
          is_model_mapped: true,
          upstream_model_name: 'private-upstream',
          response_model: observation(returned, { mismatch: stored }),
        }),
      })
      expect(formatModelName(log)).toEqual({
        name: 'requested',
        isMapped: false,
        actualModel: undefined,
        responseModel: {
          requested_model: 'requested',
          upstream_model: '',
          returned_model: '',
          mismatch: expected,
        },
      })
    }
  )
})
