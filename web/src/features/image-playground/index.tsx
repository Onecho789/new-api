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
  AlertCircleIcon,
  HistoryIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareIcon,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useAuthStore } from '@/stores/auth-store'

import { ApiKeyField } from './components/api-key-field'
import { ImageHistoryPanel } from './components/image-history-panel'
import { ImageModelSelect } from './components/image-model-select'
import { ImageParameterForm } from './components/image-parameter-form'
import { ImageResultGallery } from './components/image-result-gallery'
import { ImageUploadPanel } from './components/image-upload-panel'
import { QUALITY_OPTIONS } from './constants'
import type { ImageHistoryEntry } from './history-types'
import {
  useImageGeneration,
  useImageModels,
  useImagePlaygroundState,
  useImageUploads,
} from './hooks'
import { buildDownloadFileName, imageSrcToFile } from './lib'
import type { GeneratedImage } from './types'

export function ImagePlayground() {
  const accountId = useAuthStore((state) => state.auth.user?.id ?? null)
  // Account changes remount the workbench, releasing previews and draft files.
  return <ImageWorkbench key={accountId ?? 'anonymous'} accountId={accountId} />
}

function ImageWorkbench(props: { accountId: number | null }) {
  const { t } = useTranslation()
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const loadingReference = useRef(false)
  const [isLoadingReference, setIsLoadingReference] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isNarrowScreen = useMediaQuery('(max-width: 639px)')
  const {
    config,
    updateConfig,
    restoreConfig,
    resetSession,
    parameterEnabled,
    updateParameterEnabled,
    apiKey,
    setApiKey,
    rememberApiKey,
    setRememberApiKey,
  } = useImagePlaygroundState()
  const [requestSettingsOpen, setRequestSettingsOpen] = useState(false)
  const { models, imageModels, isLoading: isLoadingModels } = useImageModels()
  const {
    images: uploadedImages,
    mask,
    uploadError,
    addImages,
    replaceImages,
    removeImage: removeUploadedImage,
    moveImage,
    clearImages: clearUploadedImages,
    clearMask,
  } = useImageUploads()
  const requestConfig = useMemo(
    () => ({
      ...config,
      mode:
        uploadedImages.length > 0 ? ('edit' as const) : ('generate' as const),
    }),
    [config, uploadedImages.length]
  )
  const {
    images,
    tasks,
    isGenerating,
    startedAt,
    error,
    generate,
    regenerate,
    retryTask,
    setError,
    stop,
    removeImage,
    history,
    historyLoading,
    historyError,
    activeHistoryId,
    selectHistory,
    newSession,
    deleteHistory,
  } = useImageGeneration({
    accountId: props.accountId,
    apiKey,
    config: requestConfig,
    mask,
    parameterEnabled,
    uploadedImages,
  })
  const busy = isGenerating || isLoadingReference
  const canGenerate =
    !busy && config.prompt.trim() !== '' && config.model.trim() !== ''

  const handleContinueEditing = useCallback(
    async (image: GeneratedImage) => {
      if (isGenerating || loadingReference.current) return
      loadingReference.current = true
      setIsLoadingReference(true)
      try {
        const file = await imageSrcToFile(
          image.src,
          buildDownloadFileName(image)
        )
        replaceImages([file])
        clearMask()
        updateConfig('prompt', '')
        setError(null)
        requestAnimationFrame(() => promptRef.current?.focus())
        toast.success(t('Loaded into image to image, describe your changes'))
      } catch {
        toast.error(t('Failed to load this image for editing'))
      } finally {
        loadingReference.current = false
        setIsLoadingReference(false)
      }
    },
    [clearMask, isGenerating, replaceImages, setError, t, updateConfig]
  )

  const handleReusePrompt = useCallback(
    (prompt: string) => {
      updateConfig('prompt', prompt)
      promptRef.current?.focus()
      toast.success(t('Prompt copied into the input'))
    },
    [t, updateConfig]
  )

  const handleSelectHistory = (entry: ImageHistoryEntry) => {
    if (busy) return
    selectHistory(entry)
    restoreConfig(entry.config, entry.parameterEnabled)
    clearUploadedImages()
    clearMask()
    if (entry.editSnapshot?.images.length) {
      replaceImages(entry.editSnapshot.images)
    }
    setHistoryOpen(false)
  }
  const handleNewSession = () => {
    if (busy) return
    newSession()
    resetSession()
    clearUploadedImages()
    clearMask()
    setHistoryOpen(false)
    requestAnimationFrame(() => promptRef.current?.focus())
  }
  const historyPanel = (
    <ImageHistoryPanel
      entries={history}
      activeId={activeHistoryId}
      loading={historyLoading}
      disabled={busy}
      error={historyError}
      onSelect={handleSelectHistory}
      onNewSession={handleNewSession}
      onDelete={deleteHistory}
    />
  )

  const generationSettings = (
    <div className='grid grid-cols-2 gap-4'>
      <ImageModelSelect
        disabled={busy}
        imageModels={imageModels}
        isLoading={isLoadingModels}
        models={models}
        value={config.model}
        onChange={(value) => updateConfig('model', value)}
      />
      <div className='col-span-2'>
        <ImageParameterForm
          config={requestConfig}
          disabled={busy}
          onConfigChange={updateConfig}
          onParameterEnabledChange={updateParameterEnabled}
          parameterEnabled={parameterEnabled}
        />
      </div>
    </div>
  )

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Image workbench')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Dialog
          title={t('Request settings')}
          open={requestSettingsOpen}
          onOpenChange={setRequestSettingsOpen}
          contentClassName='sm:max-w-md'
          trigger={
            <Button size='sm' variant='outline'>
              <SettingsIcon aria-hidden='true' className='size-4' />
              {t('Request settings')}
            </Button>
          }
        >
          <ApiKeyField
            apiKey={apiKey}
            disabled={busy}
            onApiKeyChange={setApiKey}
            onRememberChange={setRememberApiKey}
            remember={rememberApiKey}
          />
        </Dialog>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='grid h-full min-h-0 w-full auto-rows-max content-start gap-3 overflow-y-auto @4xl/content:grid-cols-[300px_minmax(0,1fr)] @4xl/content:grid-rows-[minmax(0,1fr)] @4xl/content:content-stretch @4xl/content:overflow-hidden @5xl/content:grid-cols-[320px_minmax(0,1fr)]'>
          <aside
            aria-label={t('Generation history')}
            className='bg-card hidden min-h-0 overflow-y-auto rounded-lg border @4xl/content:block'
          >
            {historyPanel}
          </aside>
          <div className='grid min-h-0 min-w-0 auto-rows-max gap-3 @4xl/content:overflow-y-auto @6xl/content:grid-cols-[420px_minmax(0,1fr)] @6xl/content:grid-rows-[minmax(0,1fr)] @6xl/content:overflow-hidden'>
            <section
              aria-labelledby='image-compose-title'
              className='bg-card flex min-h-0 min-w-0 flex-col gap-6 rounded-lg border p-4 @6xl/content:overflow-y-auto'
            >
              <div className='flex items-center justify-between gap-2'>
                <h3 className='text-2xl font-semibold' id='image-compose-title'>
                  {t('Image workbench')}
                </h3>
                <Button
                  aria-label={t('Generation history')}
                  size='icon-sm'
                  variant='outline'
                  className='@4xl/content:hidden'
                  onClick={() => setHistoryOpen(true)}
                >
                  <HistoryIcon aria-hidden='true' className='size-4' />
                </Button>
              </div>
              <div className='space-y-2'>
                <Label className='text-base font-medium' htmlFor='image-prompt'>
                  {t('Prompt')}
                </Label>
                <Textarea
                  className='min-h-40 resize-y rounded-xl text-sm leading-relaxed'
                  disabled={busy}
                  id='image-prompt'
                  ref={promptRef}
                  rows={7}
                  placeholder={t(
                    'Describe the subject, style, composition, lighting and purpose...'
                  )}
                  value={config.prompt}
                  onChange={(event) =>
                    updateConfig('prompt', event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.ctrlKey || event.metaKey) &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      if (canGenerate) {
                        if (apiKey.trim()) void generate()
                        else setRequestSettingsOpen(true)
                      }
                    }
                  }}
                  onPaste={(event) => {
                    if (busy) return
                    const files = [...event.clipboardData.files].filter(
                      (file) => file.type.startsWith('image/')
                    )
                    if (files.length === 0) return
                    event.preventDefault()
                    addImages(files)
                  }}
                />
              </div>
              <div className='space-y-3'>
                <ImageUploadPanel
                  disabled={busy}
                  images={uploadedImages}
                  onAddImages={addImages}
                  onMoveImage={moveImage}
                  onRemoveImage={removeUploadedImage}
                />
                {uploadError ? (
                  <Alert variant='destructive'>
                    <AlertCircleIcon aria-hidden='true' className='size-4' />
                    <AlertDescription>{uploadError}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              {isNarrowScreen ? (
                <div className='flex min-w-0 items-center justify-between gap-2'>
                  <p className='text-muted-foreground min-w-0 truncate text-xs'>
                    {config.model} · {config.size} ·{' '}
                    {t(
                      QUALITY_OPTIONS.find(
                        (option) => option.value === config.quality
                      )?.descriptionKey ?? 'Auto'
                    )}
                  </p>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setSettingsOpen(true)}
                  >
                    <SlidersHorizontalIcon
                      aria-hidden='true'
                      className='size-4'
                    />
                    {t('Adjust')}
                  </Button>
                </div>
              ) : (
                generationSettings
              )}
              <div className='mt-auto space-y-3 pt-6'>
                {error ? (
                  <Alert variant='destructive'>
                    <AlertCircleIcon aria-hidden='true' className='size-4' />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {isGenerating ? (
                  <Button
                    className='h-10 w-full rounded-full'
                    variant='outline'
                    onClick={stop}
                  >
                    <SquareIcon aria-hidden='true' className='size-4' />
                    {t('Stop')}
                  </Button>
                ) : (
                  <Button
                    className='h-10 w-full rounded-full'
                    disabled={!canGenerate}
                    onClick={() => {
                      if (apiKey.trim()) void generate()
                      else setRequestSettingsOpen(true)
                    }}
                  >
                    <SparklesIcon aria-hidden='true' className='size-4' />
                    {t('Generate')}
                  </Button>
                )}
              </div>
            </section>
            <section
              aria-labelledby='image-results-title'
              className='bg-card flex min-h-96 min-w-0 flex-col rounded-lg border @6xl/content:min-h-0 @6xl/content:overflow-y-auto'
            >
              <div className='shrink-0 px-4 pt-4 pb-3'>
                <h3 className='text-xl font-semibold' id='image-results-title'>
                  {t('Results')}
                </h3>
              </div>
              <div className='flex min-h-0 flex-1 flex-col p-4'>
                <ImageResultGallery
                  actionsDisabled={isLoadingReference}
                  images={images}
                  tasks={tasks}
                  onRetryTask={(task) => {
                    if (!loadingReference.current) void retryTask(task)
                  }}
                  isGenerating={isGenerating}
                  startedAt={startedAt}
                  otherModeCount={0}
                  onContinueEditing={(image) =>
                    void handleContinueEditing(image)
                  }
                  onRegenerate={(image) => {
                    if (!loadingReference.current) void regenerate(image)
                  }}
                  onRemove={removeImage}
                  onReusePrompt={handleReusePrompt}
                />
              </div>
            </section>
          </div>
        </div>
        <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
          <DrawerContent className='h-[82vh] data-[vaul-drawer-direction=bottom]:max-h-[82vh]'>
            <DrawerHeader>
              <DrawerTitle>{t('Generation history')}</DrawerTitle>
              <DrawerDescription>
                {t(
                  'History is saved only in this browser, separately for each account.'
                )}
              </DrawerDescription>
            </DrawerHeader>
            <div className='min-h-0 flex-1 overflow-y-auto'>{historyPanel}</div>
          </DrawerContent>
        </Drawer>
        <Drawer
          open={settingsOpen && isNarrowScreen}
          onOpenChange={setSettingsOpen}
        >
          <DrawerContent className='h-[82vh] data-[vaul-drawer-direction=bottom]:max-h-[82vh]'>
            <DrawerHeader>
              <DrawerTitle>{t('Parameters')}</DrawerTitle>
              <DrawerDescription className='sr-only'>
                {t('Parameter support depends on the selected model.')}
              </DrawerDescription>
            </DrawerHeader>
            <div className='min-h-0 flex-1 overflow-y-auto p-4'>
              {isNarrowScreen ? generationSettings : null}
            </div>
          </DrawerContent>
        </Drawer>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
