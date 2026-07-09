import { useEffect, useRef, useState } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { BRAND } from '@/brand/brand.config'
import { renderToContext } from '@/engine/compositor'
import { X, ThumbsUp, MessageCircle, Send, Share2, MoreHorizontal, Heart, Bookmark } from 'lucide-react'

type FeedType = 'linkedin' | 'instagram' | 'facebook'

const FEED_CONFIG: Record<FeedType, {
  label: string
  bgColor: string
  cardBg: string
  maxWidth: number
  borderRadius: number
  avatarSize: number
}> = {
  linkedin: {
    label: 'LinkedIn',
    bgColor: '#f4f2ee',
    cardBg: '#ffffff',
    maxWidth: 552,
    borderRadius: 8,
    avatarSize: 48,
  },
  instagram: {
    label: 'Instagram',
    bgColor: '#000000',
    cardBg: '#000000',
    maxWidth: 470,
    borderRadius: 0,
    avatarSize: 32,
  },
  facebook: {
    label: 'Facebook',
    bgColor: '#f0f2f5',
    cardBg: '#ffffff',
    maxWidth: 500,
    borderRadius: 8,
    avatarSize: 40,
  },
}

/** Determine if a format is "story-like" (tall vertical, roughly 9:16) */
function isStoryFormat(width: number, height: number): boolean {
  return height / width > 1.5
}

/** Compute the ad display dimensions within the feed card */
function getAdDisplayDimensions(
  formatWidth: number,
  formatHeight: number,
  cardWidth: number,
  maxAdHeight: number,
): { adWidth: number; adHeight: number } {
  const aspect = formatWidth / formatHeight

  // For story formats, constrain height and derive width
  if (isStoryFormat(formatWidth, formatHeight)) {
    const adHeight = Math.min(maxAdHeight, cardWidth / aspect)
    const adWidth = adHeight * aspect
    return { adWidth: Math.round(adWidth), adHeight: Math.round(adHeight) }
  }

  // For landscape/square, fill the card width
  const adWidth = cardWidth
  const adHeight = Math.round(adWidth / aspect)
  return { adWidth, adHeight: Math.min(adHeight, maxAdHeight) }
}

interface Props {
  onClose: () => void
}

export function FeedPreview({ onClose }: Props) {
  const [feedType, setFeedType] = useState<FeedType>('linkedin')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doc = useDesignStore((s) => s.document)

  // Track viewport width so the mock card fits on a phone instead of overflowing.
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const config = FEED_CONFIG[feedType]
  const isStory = isStoryFormat(doc.format.width, doc.format.height)

  // For stories, use a narrower card to keep proportions realistic; on small
  // screens, cap the card to the available viewport width.
  const cardWidth = Math.min(
    isStory ? Math.round(config.maxWidth * 0.65) : config.maxWidth,
    vw - 32,
  )
  const maxAdHeight = isStory ? 520 : 600

  const { adWidth, adHeight } = getAdDisplayDimensions(
    doc.format.width,
    doc.format.height,
    cardWidth,
    maxAdHeight,
  )

  // Render the ad to the preview canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(adWidth * dpr)
    canvas.height = Math.round(adHeight * dpr)
    canvas.style.width = `${adWidth}px`
    canvas.style.height = `${adHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const renderScale = adWidth / doc.format.width
    ctx.scale(dpr, dpr)
    renderToContext(ctx, doc, renderScale)
  }, [doc, feedType, config, adWidth, adHeight])

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className="relative max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute -top-2 -right-2 z-10 p-2 bg-white rounded-full shadow-lg hover:bg-gray-50 transition-colors"
          onClick={onClose}
        >
          <X className="w-4 h-4 text-gray-600" />
        </button>

        {/* Feed type tabs */}
        <div className="flex gap-1.5 mb-4 bg-white/10 rounded-full p-1">
          {(Object.entries(FEED_CONFIG) as [FeedType, typeof config][]).map(([type, cfg]) => (
            <button
              key={type}
              className={`
                px-4 py-1.5 text-[13px] rounded-full transition-[color,background-color,box-shadow] duration-150
                ${feedType === type
                  ? 'bg-white text-gray-900 font-medium shadow-sm'
                  : 'text-white/70 hover:text-white hover:bg-white/10'}
              `}
              onClick={() => setFeedType(type)}
            >
              {cfg.label}
            </button>
          ))}
        </div>

        {/* Scrollable feed card area */}
        <div className="overflow-y-auto max-h-[calc(90vh-80px)] rounded-lg">
          {/* Feed card mockup */}
          <div
            className="mx-auto"
            style={{
              width: isStory ? cardWidth + 32 : cardWidth,
              backgroundColor: config.cardBg,
              borderRadius: config.borderRadius,
              overflow: 'hidden',
              boxShadow: feedType === 'instagram'
                ? 'none'
                : '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
            }}
          >
            {/* Post header */}
            {isStory ? (
              <StoryHeader feedType={feedType} config={config} />
            ) : (
              <PostHeader feedType={feedType} config={config} />
            )}

            {/* Ad image */}
            <div
              className="flex justify-center"
              style={{
                backgroundColor: isStory ? '#1a1a1a' : 'transparent',
              }}
            >
              <canvas
                ref={canvasRef}
                className="block"
                style={{
                  width: adWidth,
                  height: adHeight,
                  borderRadius: isStory ? 8 : 0,
                }}
              />
            </div>

            {/* Post footer */}
            {!isStory && <PostFooter feedType={feedType} />}
          </div>
        </div>

        {/* Format info */}
        <div className="text-center mt-3">
          <span className="text-[11px] text-white/50 tracking-wide uppercase">
            {doc.format.label} &middot; {doc.format.width}&times;{doc.format.height}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components for each platform's header and footer              */
/* ------------------------------------------------------------------ */

function PostHeader({ feedType, config }: { feedType: FeedType; config: typeof FEED_CONFIG[FeedType] }) {
  const textColor = feedType === 'instagram' ? '#ffffff' : '#1c1e21'
  const secondaryColor = feedType === 'instagram' ? '#a8a8a8' : '#65676b'

  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {/* Avatar */}
        <div
          className="rounded-full flex items-center justify-center shrink-0"
          style={{
            width: config.avatarSize,
            height: config.avatarSize,
            background: 'linear-gradient(135deg, #3e4576, #5a62a0)',
          }}
        >
          <span
            className="font-bold text-white"
            style={{ fontSize: config.avatarSize * 0.25 }}
          >
            {BRAND.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[14px]" style={{ color: textColor }}>
              {BRAND.displayName}
            </span>
            {feedType === 'linkedin' && (
              <span className="text-[12px]" style={{ color: secondaryColor }}>&middot; Following</span>
            )}
          </div>

          {/* Platform-specific sponsored line */}
          {feedType === 'linkedin' && (
            <div className="flex items-center gap-1 text-[12px]" style={{ color: secondaryColor }}>
              <span>AI-Powered Recruitment</span>
              <span>&middot;</span>
              <span>Promoted</span>
            </div>
          )}
          {feedType === 'instagram' && (
            <span className="text-[11px] font-medium" style={{ color: secondaryColor }}>
              Sponsored
            </span>
          )}
          {feedType === 'facebook' && (
            <div className="flex items-center gap-1 text-[12px]" style={{ color: secondaryColor }}>
              <span>Sponsored</span>
              <span>&middot;</span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill={secondaryColor}>
                <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.7 7.3l-4 4a1 1 0 01-.7.3 1 1 0 01-.7-.3l-2-2a1 1 0 111.4-1.4L7 9.2l3.3-3.3a1 1 0 111.4 1.4z" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* More button */}
      <button className="p-1 rounded-full hover:bg-black/5">
        <MoreHorizontal className="w-5 h-5" style={{ color: secondaryColor }} />
      </button>
    </div>
  )
}

function StoryHeader({ feedType, config }: { feedType: FeedType; config: typeof FEED_CONFIG[FeedType] }) {
  const textColor = '#ffffff'
  const secondaryColor = '#a8a8a8'

  return (
    <div
      className="flex items-center justify-between px-3 py-2.5"
      style={{ backgroundColor: feedType === 'instagram' ? '#000' : config.cardBg }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="rounded-full p-[2px] shrink-0"
          style={{
            background: feedType === 'instagram'
              ? 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)'
              : 'linear-gradient(135deg, #3e4576, #5a62a0)',
          }}
        >
          <div
            className="rounded-full flex items-center justify-center"
            style={{
              width: config.avatarSize,
              height: config.avatarSize,
              background: 'linear-gradient(135deg, #3e4576, #5a62a0)',
              border: '2px solid #000',
            }}
          >
            <span
              className="font-bold text-white"
              style={{ fontSize: config.avatarSize * 0.25 }}
            >
              {BRAND.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </span>
          </div>
        </div>

        <div className="flex flex-col">
          <span className="font-semibold text-[13px]" style={{ color: textColor }}>
            {BRAND.socialHandle}
          </span>
          <span className="text-[11px]" style={{ color: secondaryColor }}>
            Sponsored
          </span>
        </div>
      </div>

      <button className="p-1">
        <MoreHorizontal className="w-5 h-5 text-white/70" />
      </button>
    </div>
  )
}

function PostFooter({ feedType }: { feedType: FeedType }) {
  if (feedType === 'linkedin') {
    return (
      <div>
        {/* Reaction counts */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-100">
          <div className="flex -space-x-1">
            <span className="text-[12px]">&#x1F44D;</span>
            <span className="text-[12px]">&#x2764;&#xFE0F;</span>
          </div>
          <span className="text-[12px] text-[#65676b] ml-1">42</span>
        </div>
        {/* Action buttons */}
        <div className="flex items-center justify-between px-2 py-1">
          <FooterButton icon={<ThumbsUp className="w-4 h-4" />} label="Like" color="#65676b" />
          <FooterButton icon={<MessageCircle className="w-4 h-4" />} label="Comment" color="#65676b" />
          <FooterButton icon={<Share2 className="w-4 h-4" />} label="Repost" color="#65676b" />
          <FooterButton icon={<Send className="w-4 h-4" />} label="Send" color="#65676b" />
        </div>
      </div>
    )
  }

  if (feedType === 'instagram') {
    return (
      <div className="px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <Heart className="w-[22px] h-[22px] text-white" />
            <MessageCircle className="w-[22px] h-[22px] text-white" />
            <Send className="w-[22px] h-[22px] text-white" />
          </div>
          <Bookmark className="w-[22px] h-[22px] text-white" />
        </div>
        <div className="text-[13px] font-semibold text-white mb-0.5">128 likes</div>
        <div className="text-[13px] text-white">
          <span className="font-semibold">{BRAND.socialHandle}</span>{' '}
          <span className="text-white/80">Discover the future of hiring.</span>
        </div>
      </div>
    )
  }

  // Facebook
  return (
    <div>
      {/* Reaction counts */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <div className="flex items-center gap-1">
          <div className="flex -space-x-1">
            <span className="text-[12px]">&#x1F44D;</span>
            <span className="text-[12px]">&#x2764;&#xFE0F;</span>
          </div>
          <span className="text-[12px] text-[#65676b] ml-1">24</span>
        </div>
        <span className="text-[12px] text-[#65676b]">5 comments</span>
      </div>
      {/* Action buttons */}
      <div className="flex items-center justify-between px-2 py-1">
        <FooterButton icon={<ThumbsUp className="w-4 h-4" />} label="Like" color="#65676b" />
        <FooterButton icon={<MessageCircle className="w-4 h-4" />} label="Comment" color="#65676b" />
        <FooterButton icon={<Share2 className="w-4 h-4" />} label="Share" color="#65676b" />
      </div>
    </div>
  )
}

function FooterButton({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <button
      className="flex items-center gap-1.5 px-3 py-2 rounded-md hover:bg-black/5 transition-colors"
      style={{ color }}
    >
      {icon}
      <span className="text-[13px] font-medium">{label}</span>
    </button>
  )
}
