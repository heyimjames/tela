import type { AdFormat } from '@/types/design'

export const AD_FORMATS: AdFormat[] = [
  { id: 'linkedin-feed',      label: 'LinkedIn Feed',       platform: 'linkedin',  width: 1200, height: 627,  aspectRatio: '1.91:1' },
  { id: 'linkedin-sponsored', label: 'LinkedIn Sponsored',  platform: 'linkedin',  width: 1200, height: 1200, aspectRatio: '1:1' },
  { id: 'instagram-feed',     label: 'Instagram Feed',      platform: 'instagram', width: 1080, height: 1080, aspectRatio: '1:1' },
  { id: 'instagram-story',    label: 'Instagram Story',     platform: 'instagram', width: 1080, height: 1920, aspectRatio: '9:16' },
  { id: 'facebook-feed',      label: 'Facebook Feed',       platform: 'facebook',  width: 1200, height: 628,  aspectRatio: '1.91:1' },
  { id: 'facebook-story',     label: 'Facebook Story',      platform: 'facebook',  width: 1080, height: 1920, aspectRatio: '9:16' },
  { id: 'generic-banner',     label: 'Banner',              platform: 'generic',   width: 1200, height: 300,  aspectRatio: '4:1' },
]

export const DEFAULT_FORMAT = AD_FORMATS.find(f => f.id === 'linkedin-feed')!

export function getFormatsByPlatform(platform: string) {
  return AD_FORMATS.filter(f => f.platform === platform)
}
