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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { RichContent } from '@/components/rich-content'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { userGuideQueryOptions, userGuidesQueryOptions } from './api'

const route = getRouteApi('/_authenticated/guides/')

export function UserGuides() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const guides = useQuery(userGuidesQueryOptions())
  const list = guides.data ?? []
  // An unknown or missing id falls back to the first guide.
  const selected = list.find((guide) => guide.id === search.id) ?? list[0]
  const detail = useQuery({
    ...userGuideQueryOptions(selected?.id ?? 0),
    enabled: selected !== undefined,
  })

  const select = (id: number) => {
    void navigate({ search: { id }, replace: true })
  }

  const renderBody = () => {
    if (guides.isLoading) return <LoadingState />
    if (guides.isError) {
      return (
        <ErrorState
          description={getServerErrorMessage(guides.error)}
          onRetry={() => void guides.refetch()}
        />
      )
    }
    if (!selected) {
      return (
        <EmptyState
          icon={BookOpen}
          title={t('No guides yet')}
          description={t('Guides published by the administrator appear here.')}
        />
      )
    }
    return (
      <div className='flex h-full min-h-0 flex-col gap-3 md:flex-row md:gap-4'>
        <nav
          aria-label={t('Guides')}
          className='hidden w-56 shrink-0 overflow-y-auto border-r pr-2 md:block'
        >
          <ul className='space-y-1'>
            {list.map((guide) => (
              <li key={guide.id}>
                <button
                  type='button'
                  aria-current={guide.id === selected.id ? 'page' : undefined}
                  onClick={() => select(guide.id)}
                  className={cn(
                    'hover:bg-muted focus-visible:ring-ring/50 w-full rounded-md px-3 py-2 text-left text-sm break-words outline-none focus-visible:ring-3',
                    guide.id === selected.id && 'bg-muted font-medium'
                  )}
                >
                  {guide.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <NativeSelect
          aria-label={t('Guides')}
          className='w-full md:hidden'
          value={selected.id}
          onChange={(event) => select(Number(event.target.value))}
        >
          {list.map((guide) => (
            <NativeSelectOption key={guide.id} value={guide.id}>
              {guide.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <article className='min-h-0 min-w-0 flex-1 overflow-y-auto'>
          <h3 className='mb-4 text-xl font-semibold break-words'>
            {selected.title}
          </h3>
          {detail.isLoading && <LoadingState />}
          {detail.isError && (
            <ErrorState
              description={getServerErrorMessage(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          )}
          {detail.data && (
            <RichContent
              mode={detail.data.format}
              htmlVariant='isolated'
              content={detail.data.content ?? ''}
              className='prose-neutral dark:prose-invert max-w-none'
            />
          )}
        </article>
      </div>
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Guides')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>{renderBody()}</SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
