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
import {
  DownloadIcon,
  ImageIcon,
  MaximizeIcon,
  PencilIcon,
  RefreshCwIcon,
  TextCursorInputIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { ImageGenerationTask } from '../history-types'
import {
  buildDownloadFileName,
  downloadImage,
  getParameterMismatches,
} from '../lib'
import type { GeneratedImage } from '../types'
import {
  ImagePreviewDialog,
  type ImagePreviewTarget,
} from './image-preview-dialog'

type ImageResultGalleryProps = {
  images: GeneratedImage[]
  isGenerating: boolean
  actionsDisabled?: boolean
  startedAt?: number | null
  tasks?: ImageGenerationTask[]
  onRetryTask?: (task: ImageGenerationTask) => void
  /** 另一模式下的结果数量，提示用户结果并未丢失 */
  otherModeCount: number
  onContinueEditing: (image: GeneratedImage) => void
  onRegenerate: (image: GeneratedImage) => void
  onRemove: (id: string) => void
  onReusePrompt: (prompt: string) => void
}

function UsageSummary({ image }: { image: GeneratedImage }) {
  const { t } = useTranslation()
  const usage = image.usage
  if (!usage) return null

  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  if (inputTokens === undefined && outputTokens === undefined) return null

  return (
    <p className='text-muted-foreground text-xs'>
      {t('Tokens')}: {t('{{value}} input', { value: inputTokens ?? 0 })} /{' '}
      {t('{{value}} output', { value: outputTokens ?? 0 })}
    </p>
  )
}

function GenerationStatus(props: { startedAt?: number | null }) {
  const { t, i18n } = useTranslation()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const seconds = Math.max(
    0,
    Math.floor((now - (props.startedAt ?? now)) / 1000)
  )
  return (
    <div className='flex justify-center py-2' role='status'>
      <LoadingState
        inline
        message={
          props.startedAt == null
            ? t('Generating...')
            : t('Generating... {{seconds}}s', {
                seconds: formatNumber(seconds, locale),
              })
        }
        size='sm'
      />
    </div>
  )
}

function ImageCard(props: {
  compact?: boolean
  image: GeneratedImage
  disabled: boolean
  onContinueEditing: (image: GeneratedImage) => void
  onPreview: (target: ImagePreviewTarget) => void
  onRegenerate: (image: GeneratedImage) => void
  onRemove: (id: string) => void
  onReusePrompt: (prompt: string) => void
}) {
  const { t, i18n } = useTranslation()
  const image = props.image
  const [isDownloading, setIsDownloading] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>(
    'loading'
  )
  const [loadAttempt, setLoadAttempt] = useState(0)
  const mismatches = getParameterMismatches(image)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  /**
   * 上游只回 b64_json，src 是数 MB 的 data URL，
   * 浏览器会拦截顶层跳转到 data URL，必须转 blob 再下载。
   */
  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      await downloadImage(image.src, buildDownloadFileName(image))
    } catch {
      toast.error(t('Failed to download the image'))
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col gap-3'>
      <div
        className={cn(
          'bg-muted/30 relative flex items-center justify-center overflow-hidden rounded-xl border',
          props.compact
            ? 'aspect-square min-h-56 w-full flex-none'
            : 'min-h-72 flex-1 @4xl/content:min-h-64'
        )}
      >
        {loadState === 'error' ? (
          <ErrorState
            title={t('Image generated, but preview failed to load')}
            description={t('Retry loading the image without generating again.')}
            action={
              <Button
                variant='outline'
                onClick={() => {
                  setLoadState('loading')
                  setLoadAttempt((attempt) => attempt + 1)
                }}
              >
                <RefreshCwIcon className='size-4' />
                {t('Reload image')}
              </Button>
            }
          />
        ) : (
          <Button
            aria-label={t('View full image')}
            className={cn(
              'h-full w-full cursor-zoom-in rounded-none border-0 bg-transparent p-3 hover:bg-transparent disabled:opacity-100',
              props.compact
                ? 'absolute inset-0'
                : 'relative min-h-72 @4xl/content:min-h-64'
            )}
            disabled={loadState !== 'loaded'}
            variant='ghost'
            onClick={() =>
              props.onPreview({
                description: [
                  image.actualModel ?? image.model,
                  image.actualSize,
                ]
                  .filter(Boolean)
                  .join(' · '),
                src: image.src,
                title: image.prompt || t('Generated image'),
              })
            }
            type='button'
          >
            <img
              alt={image.prompt || t('Generated image')}
              className={cn(
                props.compact
                  ? 'absolute inset-3 size-[calc(100%-1.5rem)] object-contain'
                  : 'max-h-[55vh] w-full object-contain @4xl/content:absolute @4xl/content:inset-3 @4xl/content:size-[calc(100%-1.5rem)] @4xl/content:max-h-none',
                loadState !== 'loaded' && 'opacity-0'
              )}
              key={loadAttempt}
              src={image.src}
              onLoad={() => setLoadState('loaded')}
              onError={() => setLoadState('error')}
            />
            {loadState === 'loaded' ? (
              <span className='bg-background/80 absolute right-3 bottom-3 flex items-center gap-1 rounded-md border px-2 py-1 text-xs'>
                <MaximizeIcon className='size-3' />
                {t('Zoom')}
              </span>
            ) : null}
          </Button>
        )}
        {loadState === 'loading' ? (
          <div
            className='pointer-events-none absolute inset-0 flex items-center justify-center'
            role='status'
          >
            <LoadingState message={t('Loading image...')} />
          </div>
        ) : null}
      </div>
      <div className='space-y-3'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Badge
            className='max-w-full'
            title={image.actualModel ?? image.model}
            variant='secondary'
          >
            <span className='truncate'>{image.actualModel ?? image.model}</span>
          </Badge>
          <Badge variant='outline'>
            {image.mode === 'edit' ? t('Image to image') : t('Text to image')}
          </Badge>
          {image.actualSize ? (
            <Badge variant='outline'>{image.actualSize}</Badge>
          ) : null}
          {image.actualQuality ? (
            <Badge variant='outline'>{image.actualQuality}</Badge>
          ) : null}
          {image.actualOutputFormat ? (
            <Badge variant='outline'>{image.actualOutputFormat}</Badge>
          ) : null}
          {image.actualBackground && image.actualBackground !== 'auto' ? (
            <Badge variant='outline'>{image.actualBackground}</Badge>
          ) : null}
          {image.durationMs !== undefined ? (
            <span className='text-muted-foreground text-xs'>
              {t('Completed in {{seconds}}s', {
                seconds: formatNumber(
                  Math.round(image.durationMs / 1000),
                  locale
                ),
              })}
            </span>
          ) : null}
        </div>

        {mismatches.length > 0 ? (
          <div className='text-xs leading-4 text-amber-600 dark:text-amber-500'>
            {mismatches.map((item) => (
              <p key={item.label}>
                {t('Upstream returned a different {{field}}', {
                  field: item.label,
                })}
                : {item.requested} → {item.actual}
              </p>
            ))}
          </div>
        ) : null}

        <div className='flex items-start gap-2'>
          <p className='text-muted-foreground max-h-20 min-w-0 flex-1 overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap'>
            {image.revisedPrompt || image.prompt}
          </p>
          <CopyButton size='sm' value={image.revisedPrompt || image.prompt} />
        </div>

        <UsageSummary image={image} />

        {/* 不满意时的三条去路：接着改这张、原样重跑、改提示词再跑 */}
        <div className='flex flex-wrap gap-2'>
          <Button
            disabled={props.disabled}
            size='sm'
            variant='outline'
            onClick={() => props.onContinueEditing(image)}
          >
            <PencilIcon className='size-4' />
            {t('Continue editing')}
          </Button>
          <Button
            disabled={props.disabled}
            size='sm'
            variant='outline'
            onClick={() => props.onRegenerate(image)}
          >
            <RefreshCwIcon className='size-4' />
            {t('Regenerate')}
          </Button>
          <Button
            disabled={props.disabled}
            size='sm'
            variant='outline'
            onClick={() =>
              props.onReusePrompt(image.revisedPrompt || image.prompt)
            }
          >
            <TextCursorInputIcon className='size-4' />
            {t('Reuse prompt')}
          </Button>
          <Button
            disabled={isDownloading}
            size='sm'
            variant='outline'
            onClick={() => void handleDownload()}
          >
            {isDownloading ? (
              <Spinner className='size-4' />
            ) : (
              <DownloadIcon className='size-4' />
            )}
            {t('Download')}
          </Button>
          <Button
            disabled={props.disabled}
            size='sm'
            variant='ghost'
            onClick={() => props.onRemove(image.id)}
          >
            <Trash2Icon className='size-4' />
            {t('Remove')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TaskStatusCard(props: {
  task: ImageGenerationTask
  disabled: boolean
  onRetryTask?: (task: ImageGenerationTask) => void
}) {
  const { t } = useTranslation()
  if (props.task.status === 'pending') {
    return (
      <div
        className='bg-muted/30 flex min-h-64 flex-1 items-center justify-center rounded-xl border border-dashed'
        role='status'
      >
        <LoadingState message={t('Generating...')} />
      </div>
    )
  }
  return (
    <div className='bg-destructive/5 border-destructive/20 flex min-h-64 flex-1 items-center justify-center rounded-xl border'>
      <ErrorState
        className='min-h-64 w-full p-4 break-words'
        title={
          props.task.status === 'interrupted'
            ? t('Image generation interrupted')
            : t('Image generation failed')
        }
        description={props.task.error}
        action={
          props.onRetryTask ? (
            <Button
              disabled={props.disabled}
              size='sm'
              variant='outline'
              onClick={() => props.onRetryTask?.(props.task)}
            >
              <RefreshCwIcon className='size-4' />
              {t('Retry')}
            </Button>
          ) : undefined
        }
      />
    </div>
  )
}

export function ImageResultGallery({
  images,
  isGenerating,
  actionsDisabled,
  startedAt,
  tasks,
  onRetryTask,
  otherModeCount,
  onContinueEditing,
  onRegenerate,
  onRemove,
  onReusePrompt,
}: ImageResultGalleryProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<ImagePreviewTarget | null>(null)
  const newestId = images[0]?.id
  const [selection, setSelection] = useState({ newestId, id: newestId })
  // A new batch selects its first result before children render with stale selection.
  if (selection.newestId !== newestId) {
    setSelection({ newestId, id: newestId })
  }
  const selectedId = selection.newestId === newestId ? selection.id : newestId
  const selectedImage =
    images.find((image) => image.id === selectedId) ?? images[0]
  const visibleTasks = tasks?.filter(
    (task) => task.status !== 'success' || task.images.length > 0
  )
  const hasTasks = Boolean(visibleTasks?.length)
  const useTaskGrid = (visibleTasks?.length ?? 0) > 1
  const disabled = isGenerating || Boolean(actionsDisabled)

  const otherModeHint =
    otherModeCount > 0 ? (
      <p className='text-muted-foreground text-center text-xs'>
        {t('{{value}} more results belong to the other mode.', {
          value: otherModeCount,
        })}
      </p>
    ) : null

  if (isGenerating && images.length === 0 && !hasTasks) {
    return (
      <div className='bg-muted/10 flex min-h-80 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed'>
        <GenerationStatus key={startedAt} startedAt={startedAt} />
        {otherModeHint}
      </div>
    )
  }

  if (images.length === 0 && !hasTasks) {
    return (
      <div className='flex min-h-80 flex-1 flex-col items-center justify-center gap-3'>
        <EmptyState
          icon={ImageIcon}
          title={t('No images yet')}
          description={t(
            'Enter a prompt and click Generate to create an image.'
          )}
        />
        {otherModeHint}
      </div>
    )
  }

  return (
    <div className='@container/results flex min-h-0 min-w-0 flex-1 flex-col gap-3'>
      {isGenerating ? (
        <GenerationStatus key={startedAt} startedAt={startedAt} />
      ) : null}
      {otherModeHint}
      {useTaskGrid ? (
        <div className='grid items-start gap-3 @xl/results:grid-cols-2'>
          {visibleTasks?.map((task) => (
            <div
              aria-label={t('Image {{value}}', { value: task.index + 1 })}
              className='flex min-w-0 flex-col gap-3 rounded-xl border p-3'
              key={task.id}
              role='group'
            >
              <p className='text-muted-foreground text-xs font-medium'>
                {t('Image {{value}}', { value: task.index + 1 })}
              </p>
              {task.status === 'success' ? (
                task.images.map((image) => (
                  <ImageCard
                    compact
                    disabled={disabled}
                    image={image}
                    key={image.id}
                    onContinueEditing={onContinueEditing}
                    onPreview={setPreview}
                    onRegenerate={onRegenerate}
                    onRemove={onRemove}
                    onReusePrompt={onReusePrompt}
                  />
                ))
              ) : (
                <TaskStatusCard
                  disabled={disabled}
                  task={task}
                  onRetryTask={onRetryTask}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
      {!useTaskGrid && selectedImage ? (
        <ImageCard
          disabled={disabled}
          image={selectedImage}
          key={selectedImage.id}
          onContinueEditing={onContinueEditing}
          onPreview={setPreview}
          onRegenerate={onRegenerate}
          onRemove={onRemove}
          onReusePrompt={onReusePrompt}
        />
      ) : null}
      {!useTaskGrid
        ? visibleTasks
            ?.filter((task) => task.status !== 'success')
            .map((task) => (
              <TaskStatusCard
                disabled={disabled}
                key={task.id}
                task={task}
                onRetryTask={onRetryTask}
              />
            ))
        : null}
      {!useTaskGrid && images.length > 1 ? (
        <div
          aria-label={t('Results')}
          className='flex shrink-0 gap-2 overflow-x-auto p-1'
          role='group'
        >
          {images.map((image, index) => (
            <Button
              aria-label={t('Select image {{value}}', { value: index + 1 })}
              aria-pressed={image.id === selectedImage?.id}
              className={cn(
                'bg-muted/30 size-16 overflow-hidden rounded-lg p-1',
                image.id === selectedImage?.id &&
                  'border-primary ring-primary/30 ring-2'
              )}
              key={image.id}
              onClick={() => setSelection({ newestId, id: image.id })}
              title={image.prompt}
              variant='outline'
            >
              <img
                alt=''
                className='size-full rounded object-cover'
                loading='lazy'
                src={image.src}
              />
            </Button>
          ))}
        </div>
      ) : null}

      <ImagePreviewDialog
        target={preview}
        onOpenChange={(open) => !open && setPreview(null)}
      />
    </div>
  )
}
