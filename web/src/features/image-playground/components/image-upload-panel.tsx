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
  MaximizeIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
  XIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_IMAGES,
  MAX_UPLOAD_SIZE_BYTES,
} from '../constants'
import {
  extractFilesFromDataTransfer,
  formatFileSize,
  getMaskSizeMismatch,
} from '../lib'
import type { UploadedImage } from '../types'
import {
  ImagePreviewDialog,
  type ImagePreviewTarget,
} from './image-preview-dialog'

/** 透明区域的棋盘底，避免透明蒙版在白底上看不见 */
const CHECKERBOARD_CLASS =
  'bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%),linear-gradient(-45deg,var(--muted)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--muted)_75%),linear-gradient(-45deg,transparent_75%,var(--muted)_75%)] bg-[length:12px_12px] bg-[position:0_0,0_6px,6px_-6px,-6px_0]'

type DropZoneProps = {
  compact?: boolean
  disabled?: boolean
  hint: string
  multiple?: boolean
  onFiles: (files: File[]) => void
}

/** 支持点选与拖拽的上传区 */
function DropZone({
  compact,
  disabled,
  hint,
  multiple,
  onFiles,
}: DropZoneProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) return
    onFiles(extractFilesFromDataTransfer(event.dataTransfer))
  }

  return (
    <div
      className={cn(
        'rounded-md border border-dashed text-center transition-colors',
        compact ? 'p-3' : 'p-4',
        isDragging ? 'border-primary bg-primary/5' : 'border-input',
        disabled ? 'opacity-60' : 'cursor-pointer hover:border-primary/60'
      )}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragLeave={() => setIsDragging(false)}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setIsDragging(true)
      }}
      onDrop={handleDrop}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      role='button'
      tabIndex={disabled ? -1 : 0}
    >
      <input
        accept={ACCEPTED_IMAGE_TYPES}
        className='hidden'
        disabled={disabled}
        multiple={multiple}
        ref={inputRef}
        type='file'
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          onFiles(files)
          // 重置以便重复选择同一文件时仍能触发 change
          event.target.value = ''
        }}
      />
      <UploadCloudIcon className='text-muted-foreground mx-auto size-5' />
      <p className='mt-1.5 text-sm font-medium'>
        {t('Click or drag images here')}
      </p>
      <p className='text-muted-foreground mt-1 text-xs leading-4'>{hint}</p>
    </div>
  )
}

function PreviewTile({
  image,
  disabled,
  onPreview,
  onRemove,
}: {
  image: UploadedImage
  disabled?: boolean
  onPreview: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className='group relative w-40 overflow-hidden rounded-md border'>
      {/* object-contain + 定高，保证整张图可见而不是被裁掉 */}
      <button
        aria-label={t('View full image')}
        className={cn(
          'relative block h-28 w-full cursor-zoom-in',
          CHECKERBOARD_CLASS
        )}
        onClick={onPreview}
        type='button'
      >
        <img
          alt={image.file.name}
          className='h-full w-full object-contain'
          src={image.objectUrl}
        />
        <span className='bg-background/70 absolute bottom-1 left-1 flex items-center gap-1 rounded px-1 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100'>
          <MaximizeIcon className='size-3' />
          {t('Zoom')}
        </span>
      </button>
      <Button
        aria-label={t('Remove')}
        className='absolute top-1 right-1 size-6 opacity-80'
        disabled={disabled}
        size='icon'
        variant='secondary'
        onClick={onRemove}
      >
        <XIcon className='size-3.5' />
      </Button>
      <div className='bg-background/85 truncate border-t px-1.5 py-1 text-[11px]'>
        {image.file.name}
        <span className='text-muted-foreground'>
          {' · '}
          {formatFileSize(image.file.size)}
          {image.width && image.height
            ? ` · ${image.width}x${image.height}`
            : ''}
        </span>
      </div>
    </div>
  )
}

/** 蒙版语义说明：用色块直观表达透明=可改、不透明=保留 */
function MaskExplainer() {
  const { t } = useTranslation()

  return (
    <div className='bg-muted/40 space-y-2 rounded-md border p-2.5'>
      <p className='text-xs font-medium'>{t('How the mask works')}</p>
      <div className='flex flex-wrap gap-x-4 gap-y-1.5'>
        <span className='flex items-center gap-1.5 text-xs'>
          <span
            className={cn('size-3.5 rounded-sm border', CHECKERBOARD_CLASS)}
          />
          {t('Transparent area: the model may change it')}
        </span>
        <span className='flex items-center gap-1.5 text-xs'>
          <span className='bg-foreground size-3.5 rounded-sm border' />
          {t('Opaque area: kept exactly as the original')}
        </span>
      </div>
      <ul className='text-muted-foreground space-y-1 text-xs leading-4'>
        <li>
          {t('The mask must be a PNG with the same size as the source image.')}
        </li>
        <li>{t('Without a mask the whole image can be changed.')}</li>
      </ul>
    </div>
  )
}

type ImageUploadPanelProps = {
  disabled?: boolean
  images: UploadedImage[]
  mask: UploadedImage | null
  onAddImages: (files: File[]) => void
  onClearImages: () => void
  onClearMask: () => void
  onRemoveImage: (id: string) => void
  onSetMask: (files: File[]) => void
}

export function ImageUploadPanel({
  disabled,
  images,
  mask,
  onAddImages,
  onClearImages,
  onClearMask,
  onRemoveImage,
  onSetMask,
}: ImageUploadPanelProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<ImagePreviewTarget | null>(null)
  const maskMismatch = getMaskSizeMismatch(images, mask)

  const describe = (image: UploadedImage) =>
    [
      formatFileSize(image.file.size),
      image.width && image.height ? `${image.width}x${image.height}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-baseline gap-1.5'>
            <Label>{t('Source images')}</Label>
            <span className='text-muted-foreground font-mono text-xs'>
              {images.length > 1 ? 'image[]' : 'image'}
            </span>
            {images.length > 0 ? (
              <span className='text-muted-foreground text-xs'>
                {t('{{value}} / {{limit}}', {
                  limit: MAX_UPLOAD_IMAGES,
                  value: images.length,
                })}
              </span>
            ) : null}
          </div>
          {images.length > 0 ? (
            <Button
              disabled={disabled}
              size='sm'
              variant='ghost'
              onClick={onClearImages}
            >
              {t('Clear all')}
            </Button>
          ) : null}
        </div>

        {images.length > 0 ? (
          /* 用 flex 居中，图少时不会孤零零贴在左边 */
          <div className='flex flex-wrap justify-center gap-2'>
            {images.map((image) => (
              <PreviewTile
                disabled={disabled}
                image={image}
                key={image.id}
                onPreview={() =>
                  setPreview({
                    description: describe(image),
                    src: image.objectUrl,
                    title: image.file.name,
                  })
                }
                onRemove={() => onRemoveImage(image.id)}
              />
            ))}
          </div>
        ) : null}

        {images.length < MAX_UPLOAD_IMAGES ? (
          <DropZone
            compact={images.length > 0}
            disabled={disabled}
            hint={t(
              'PNG, JPEG or WebP, up to {{size}} each, at most {{count}} images',
              {
                count: MAX_UPLOAD_IMAGES,
                size: formatFileSize(MAX_UPLOAD_SIZE_BYTES),
              }
            )}
            multiple
            onFiles={onAddImages}
          />
        ) : null}
      </div>

      <div className='space-y-2'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-baseline gap-1.5'>
            <Label>{t('Mask (optional)')}</Label>
            <span className='text-muted-foreground font-mono text-xs'>
              mask
            </span>
          </div>
          {mask ? (
            <Button
              disabled={disabled}
              size='sm'
              variant='ghost'
              onClick={onClearMask}
            >
              {t('Remove')}
            </Button>
          ) : null}
        </div>

        {mask ? (
          <div className='flex flex-wrap justify-center gap-2'>
            <PreviewTile
              disabled={disabled}
              image={mask}
              onPreview={() =>
                setPreview({
                  description: describe(mask),
                  src: mask.objectUrl,
                  title: mask.file.name,
                })
              }
              onRemove={onClearMask}
            />
          </div>
        ) : (
          <DropZone
            disabled={disabled}
            hint={t('A single PNG with transparency')}
            onFiles={onSetMask}
          />
        )}

        {maskMismatch ? (
          <p className='flex gap-1.5 text-xs leading-4 text-amber-600 dark:text-amber-500'>
            <TriangleAlertIcon className='mt-0.5 size-3.5 shrink-0' />
            <span>
              {t(
                'The mask is {{maskSize}} but the source image is {{imageSize}}. Upstream may reject it or apply the edit to the wrong area.',
                maskMismatch
              )}
            </span>
          </p>
        ) : null}

        <MaskExplainer />
      </div>

      <ImagePreviewDialog
        target={preview}
        onOpenChange={(open) => !open && setPreview(null)}
      />
    </div>
  )
}
