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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'

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

function ImageCard({
  image,
  onContinueEditing,
  onPreview,
  onRegenerate,
  onRemove,
  onReusePrompt,
}: {
  image: GeneratedImage
  onContinueEditing: (image: GeneratedImage) => void
  onPreview: (target: ImagePreviewTarget) => void
  onRegenerate: (image: GeneratedImage) => void
  onRemove: (id: string) => void
  onReusePrompt: (prompt: string) => void
}) {
  const { t } = useTranslation()
  const [isDownloading, setIsDownloading] = useState(false)
  const mismatches = getParameterMismatches(image)

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
    <Card className='w-full max-w-md overflow-hidden'>
      <button
        aria-label={t('View full image')}
        className='bg-muted relative block w-full cursor-zoom-in'
        onClick={() =>
          onPreview({
            description: [image.actualModel ?? image.model, image.actualSize]
              .filter(Boolean)
              .join(' · '),
            src: image.src,
            title: image.prompt || t('Generated image'),
          })
        }
        type='button'
      >
        {/* 生成结果尺寸不定，用 h-auto 保持原始比例 */}
        <img
          alt={image.prompt || t('Generated image')}
          className='h-auto w-full object-contain'
          loading='lazy'
          src={image.src}
        />
        <span className='bg-background/70 absolute right-2 bottom-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]'>
          <MaximizeIcon className='size-3' />
          {t('Zoom')}
        </span>
      </button>
      <CardContent className='space-y-2 p-3'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Badge variant='secondary'>{image.actualModel ?? image.model}</Badge>
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

        {image.revisedPrompt ? (
          <p className='text-muted-foreground line-clamp-3 text-xs leading-4'>
            {image.revisedPrompt}
          </p>
        ) : null}

        <UsageSummary image={image} />

        {/* 不满意时的三条去路：接着改这张、原样重跑、改提示词再跑 */}
        <div className='grid grid-cols-2 gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => onContinueEditing(image)}
          >
            <PencilIcon className='size-4' />
            {t('Continue editing')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => onRegenerate(image)}
          >
            <RefreshCwIcon className='size-4' />
            {t('Regenerate')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => onReusePrompt(image.revisedPrompt || image.prompt)}
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
        </div>

        <Button
          className='w-full'
          size='sm'
          variant='ghost'
          onClick={() => onRemove(image.id)}
        >
          <Trash2Icon className='size-4' />
          {t('Remove')}
        </Button>
      </CardContent>
    </Card>
  )
}

export function ImageResultGallery({
  images,
  isGenerating,
  otherModeCount,
  onContinueEditing,
  onRegenerate,
  onRemove,
  onReusePrompt,
}: ImageResultGalleryProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<ImagePreviewTarget | null>(null)

  const otherModeHint =
    otherModeCount > 0 ? (
      <p className='text-muted-foreground text-center text-xs'>
        {t('{{value}} more results belong to the other mode.', {
          value: otherModeCount,
        })}
      </p>
    ) : null

  if (isGenerating && images.length === 0) {
    return (
      <div className='flex min-h-64 flex-col items-center justify-center gap-3'>
        <Spinner className='size-6' />
        <p className='text-muted-foreground text-sm'>{t('Generating...')}</p>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className='flex min-h-64 flex-col items-center justify-center gap-3 text-center'>
        <ImageIcon className='text-muted-foreground size-10' />
        <div className='space-y-1'>
          <p className='text-sm font-medium'>{t('No images yet')}</p>
          <p className='text-muted-foreground text-sm'>
            {t('Enter a prompt and click Generate to create an image.')}
          </p>
          {otherModeHint}
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {isGenerating ? (
        <div className='text-muted-foreground flex items-center justify-center gap-2 text-sm'>
          <Spinner className='size-4' />
          {t('Generating...')}
        </div>
      ) : null}
      {otherModeHint}
      {/* flex + 定宽卡片：结果不足一行时居中，而不是靠左拉宽 */}
      <div className='flex flex-wrap justify-center gap-4'>
        {images.map((image) => (
          <ImageCard
            image={image}
            key={image.id}
            onContinueEditing={onContinueEditing}
            onPreview={setPreview}
            onRegenerate={onRegenerate}
            onRemove={onRemove}
            onReusePrompt={onReusePrompt}
          />
        ))}
      </div>

      <ImagePreviewDialog
        target={preview}
        onOpenChange={(open) => !open && setPreview(null)}
      />
    </div>
  )
}
