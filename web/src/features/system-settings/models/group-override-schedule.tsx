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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'

export interface GroupOverrideRule {
  ratio: number
  enabled: boolean
  starts_at: number
  ends_at: number
}

export type GroupOverrideValue = number | GroupOverrideRule
export type GroupOverrideMap = Record<
  string,
  Record<string, GroupOverrideValue>
>

export function GroupOverrideSchedule(props: {
  rule: GroupOverrideRule
  showStatus?: boolean
}) {
  const { t, i18n } = useTranslation()
  const [clockTick, setClockTick] = useState(0)
  const now = Math.floor(Date.now() / 1000)
  const rule = props.rule
  let nextChange = 0
  let label = t('In effect')
  if (!rule.enabled) label = t('Manually disabled')
  else if (rule.starts_at > now) {
    label = t('Not started')
    nextChange = rule.starts_at
  } else if (rule.ends_at > 0 && now >= rule.ends_at) label = t('Expired')
  else if (rule.ends_at > 0) nextChange = rule.ends_at
  useEffect(() => {
    if (!nextChange || props.showStatus === false) return
    const timer = window.setTimeout(
      () => setClockTick((value) => value + 1),
      Math.min(2147483647, Math.max(1, nextChange * 1000 - Date.now()))
    )
    return () => window.clearTimeout(timer)
  }, [nextChange, clockTick, props.showStatus])
  const formatter = new Intl.DateTimeFormat(
    toIntlLocale(i18n.resolvedLanguage || i18n.language),
    { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }
  )
  return (
    <div className='space-y-1 text-xs'>
      {props.showStatus !== false && (
        <StatusBadge
          copyable={false}
          variant={
            rule.enabled &&
            rule.starts_at <= now &&
            (rule.ends_at === 0 || now < rule.ends_at)
              ? 'success'
              : 'neutral'
          }
        >
          {label}
        </StatusBadge>
      )}
      <p>
        {t('Start time (Beijing time)')}:{' '}
        {rule.starts_at > 0 ? (
          <time dateTime={new Date(rule.starts_at * 1000).toISOString()}>
            {formatter.format(rule.starts_at * 1000)}
          </time>
        ) : (
          t('Starts immediately')
        )}
      </p>
      <p>
        {t('End time (Beijing time)')}:{' '}
        {rule.ends_at > 0 ? (
          <time dateTime={new Date(rule.ends_at * 1000).toISOString()}>
            {formatter.format(rule.ends_at * 1000)}
          </time>
        ) : (
          t('No end time')
        )}
      </p>
    </div>
  )
}
