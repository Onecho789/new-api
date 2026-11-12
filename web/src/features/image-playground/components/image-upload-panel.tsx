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
  ArrowLeftIcon,
  ArrowRightIcon,
  ClipboardPasteIcon,
  UploadCloudIcon,
  XIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_IMAGES } from '../constants'
import { extractFilesFromDataTransfer } from '../lib'
import type { UploadedImage } from '../types'
import {
  ImagePreviewDialog,
  type ImagePreviewTarget,
} from './image-preview-dialog'

type ImageUploadPanelProps = {
  compact?: boolean
  disabled?: boolean
  images: UploadedImage[]
  mask?: UploadedImage | null
  onAddImages: (files: File[]) => void
  onClearImages?: () => void
  onClearMask?: () => void
  onMoveImage?: (id: string, direction: -1 | 1) => void
  onRemoveImage: (id: string) => void
  onSetMask?: (files: File[]) => void
}

export function ImageUploadPanel({
  disabled,
  images,
  onAddImages,
  onRemoveImage,
  onMoveImage,
}: ImageUploadPanelProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<ImagePreviewTarget | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const [clipboardError, setClipboardError] = useState<string | null>(null)
  const [readingClipboard, setReadingClipboard] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const pasteReferences = async () => {
    if (disabled || readingClipboard) return
    setReadingClipboard(true)
    setClipboardError(null)
    try {
      const items = await navigator.clipboard.read()
      const acceptedTypes = ACCEPTED_IMAGE_TYPES.split(',')
      const files: File[] = []
      for (const item of items) {
        const type = item.types.find((candidate) =>
          acceptedTypes.includes(candidate)
        )
        if (!type) continue
        const blob = await item.getType(type)
        files.push(
          new File(
            [blob],
            `reference-${files.length + 1}.${type.split('/')[1]}`,
            { type }
          )
        )
      }
      if (disabledRef.current) return
      if (files.length === 0) {
        setClipboardError(t('No image found in the clipboard'))
      } else {
        onAddImages(files)
      }
    } catch {
      setClipboardError(
        t('Unable to read the clipboard. Paste an image here instead.')
      )
    } finally {
      setReadingClipboard(false)
    }
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <Label className='text-base font-medium'>{t('Reference images')}</Label>
        <div className='flex shrink-0 items-center gap-1'>
          <Button
            size='xs'
            variant='outline'
            disabled={
              disabled || readingClipboard || images.length >= MAX_UPLOAD_IMAGES
            }
            onClick={() => void pasteReferences()}
          >
            <ClipboardPasteIcon aria-hidden='true' className='size-3.5' />
            {t('Clipboard')}
          </Button>
          <Button
            size='xs'
            variant='outline'
            disabled={disabled || images.length >= MAX_UPLOAD_IMAGES}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloudIcon aria-hidden='true' className='size-3.5' />
            {t('Upload')}
          </Button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        accept={ACCEPTED_IMAGE_TYPES}
        className='hidden'
        aria-label={t('Upload reference images')}
        disabled={disabled}
        onChange={(event) => {
          if (!disabled) onAddImages([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
      {clipboardError ? (
        <Alert variant='destructive'>
          <AlertDescription>{clipboardError}</AlertDescription>
        </Alert>
      ) : null}
      <div
        role='group'
        aria-label={t('Click, drop or paste reference images')}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        className={cn(
          'flex min-h-24 items-center gap-2 overflow-x-auto rounded-xl border border-dashed p-2 pb-3',
          isDragging && !disabled && 'border-primary bg-primary/5'
        )}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          if (!disabled) {
            onAddImages(extractFilesFromDataTransfer(event.dataTransfer))
          }
        }}
        onPaste={(event) => {
          if (disabled) return
          const files = extractFilesFromDataTransfer(
            event.clipboardData
          ).filter((file) => file.type.startsWith('image/'))
          if (files.length === 0) return
          event.preventDefault()
          onAddImages(files)
        }}
      >
        {images.length === 0 ? (
          <button
            type='button'
            className='text-muted-foreground min-h-16 w-full text-center text-xs'
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('Click, drop or paste reference images')}
          </button>
        ) : (
          images.map((image, index) => (
            <div
              key={image.id}
              className='group relative size-20 shrink-0 overflow-hidden rounded-lg'
            >
              <button
                type='button'
                className='size-full'
                onClick={() =>
                  setPreview({ src: image.objectUrl, title: image.file.name })
                }
              >
                <img
                  src={image.objectUrl}
                  alt={image.file.name}
                  className='size-full object-cover'
                />
              </button>
              <span className='pointer-events-none absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white'>
                {t('Image {{number}}', { number: index + 1 })}
              </span>
              <Button
                aria-label={t('Remove {{name}}', { name: image.file.name })}
                className='absolute top-1 right-1 size-5 rounded-full bg-black/60 p-0 text-white hover:bg-black/80'
                disabled={disabled}
                size='icon-xs'
                variant='ghost'
                onClick={() => onRemoveImage(image.id)}
              >
                <XIcon aria-hidden='true' className='size-3' />
              </Button>
              {onMoveImage ? (
                <div className='absolute inset-x-1 bottom-1 flex justify-between'>
                  <Button
                    aria-label={t('Move {{name}} earlier', {
                      name: image.file.name,
                    })}
                    className='size-5 rounded bg-black/60 p-0 text-white hover:bg-black/80'
                    disabled={disabled || index === 0}
                    size='icon-xs'
                    variant='ghost'
                    onClick={() => onMoveImage(image.id, -1)}
                  >
                    <ArrowLeftIcon aria-hidden='true' className='size-3' />
                  </Button>
                  <Button
                    aria-label={t('Move {{name}} later', {
                      name: image.file.name,
                    })}
                    className='size-5 rounded bg-black/60 p-0 text-white hover:bg-black/80'
                    disabled={disabled || index === images.length - 1}
                    size='icon-xs'
                    variant='ghost'
                    onClick={() => onMoveImage(image.id, 1)}
                  >
                    <ArrowRightIcon aria-hidden='true' className='size-3' />
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <ImagePreviewDialog
        target={preview}
        onOpenChange={(open) => !open && setPreview(null)}
      />
    </div>
  )
}
