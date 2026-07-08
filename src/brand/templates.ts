import { nanoid } from 'nanoid'
import { BRAND } from '@/brand/brand.config'
import { DEFAULT_FORMAT, AD_FORMATS } from '@/brand/formats'
import { getBrandColor } from '@/brand/palette'
import type { DesignDocument } from '@/types/design'

export interface DesignTemplate {
  id: string
  name: string
  category: 'hiring' | 'employer-brand' | 'event' | 'testimonial' | 'general'
  description: string
  formatId: string
  create: () => DesignDocument
}

function makeDoc(
  name: string,
  formatId: string,
  layers: Array<Record<string, any>>,
): DesignDocument {
  const format = AD_FORMATS.find((f) => f.id === formatId) ?? DEFAULT_FORMAT
  const now = new Date().toISOString()
  return {
    id: nanoid(),
    name,
    format,
    layers: layers.map((l, i) => ({ ...l, id: nanoid(), zIndex: i }) as any),
    createdAt: now,
    updatedAt: now,
  }
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'hiring-linkedin',
    name: 'We\'re Hiring — LinkedIn',
    category: 'hiring',
    description: 'Clean job post ad with brand dark background, white headline, and CTA',
    formatId: 'linkedin-feed',
    create: () => makeDoc('We\'re Hiring', 'linkedin-feed', [
      { type: 'background', name: 'Background', visible: true, locked: false, opacity: 1, x: 0, y: 0, width: 1200, height: 627, rotation: 0, fill: { type: 'solid', color: getBrandColor('brand-dark') } },
      { type: 'text', name: 'Headline', visible: true, locked: false, opacity: 1, x: 80, y: 160, width: 700, height: 80, rotation: 0, content: 'We\'re Hiring', fontSize: 64, fontWeight: 700, textAlign: 'left', color: getBrandColor('white'), letterSpacing: -0.03, lineHeight: 1.1, textTransform: 'none' },
      { type: 'text', name: 'Role', visible: true, locked: false, opacity: 1, x: 80, y: 260, width: 700, height: 50, rotation: 0, content: 'Senior Software Engineer', fontSize: 32, fontWeight: 400, textAlign: 'left', color: getBrandColor('brand-accent'), letterSpacing: -0.01, lineHeight: 1.3, textTransform: 'none' },
      { type: 'text', name: 'CTA', visible: true, locked: false, opacity: 1, x: 80, y: 440, width: 200, height: 40, rotation: 0, content: 'Apply Now →', fontSize: 18, fontWeight: 600, textAlign: 'left', color: getBrandColor('white'), letterSpacing: 0, lineHeight: 1.4, textTransform: 'none' },
      { type: 'shape', name: 'CTA Background', visible: true, locked: false, opacity: 1, x: 60, y: 425, width: 240, height: 56, rotation: 0, shape: 'pill', fill: getBrandColor('ember-500'), borderRadius: 9999 },
    ]),
  },
  {
    id: 'hiring-instagram',
    name: 'We\'re Hiring — Instagram',
    category: 'hiring',
    description: 'Square format job post for Instagram feed',
    formatId: 'instagram-feed',
    create: () => makeDoc('We\'re Hiring', 'instagram-feed', [
      { type: 'background', name: 'Background', visible: true, locked: false, opacity: 1, x: 0, y: 0, width: 1080, height: 1080, rotation: 0, fill: { type: 'gradient', gradientType: 'linear', angle: 135, stops: [{ position: 0, color: getBrandColor('teal-800') }, { position: 1, color: getBrandColor('brand-dark') }] } },
      { type: 'text', name: 'Badge', visible: true, locked: false, opacity: 1, x: 80, y: 120, width: 300, height: 30, rotation: 0, content: 'JOIN OUR TEAM', fontSize: 16, fontWeight: 600, textAlign: 'left', color: getBrandColor('ember-500'), letterSpacing: 0.12, lineHeight: 1.2, textTransform: 'uppercase' },
      { type: 'text', name: 'Headline', visible: true, locked: false, opacity: 1, x: 80, y: 180, width: 920, height: 200, rotation: 0, content: 'We\'re looking for a\nSenior Designer', fontSize: 56, fontWeight: 700, textAlign: 'left', color: getBrandColor('white'), letterSpacing: -0.02, lineHeight: 1.15, textTransform: 'none' },
      { type: 'text', name: 'Description', visible: true, locked: false, opacity: 1, x: 80, y: 750, width: 600, height: 60, rotation: 0, content: 'Remote · Full Time · Competitive Salary', fontSize: 20, fontWeight: 400, textAlign: 'left', color: getBrandColor('brand-accent'), letterSpacing: 0, lineHeight: 1.4, textTransform: 'none' },
      { type: 'text', name: 'Company', visible: true, locked: false, opacity: 1, x: 80, y: 950, width: 300, height: 30, rotation: 0, content: BRAND.website, fontSize: 18, fontWeight: 500, textAlign: 'left', color: getBrandColor('white'), letterSpacing: 0, lineHeight: 1.4, textTransform: 'none' },
    ]),
  },
  {
    id: 'stat-callout',
    name: 'Stat Callout',
    category: 'employer-brand',
    description: 'Big number with supporting text — great for engagement stats',
    formatId: 'linkedin-sponsored',
    create: () => makeDoc('Stat Callout', 'linkedin-sponsored', [
      { type: 'background', name: 'Background', visible: true, locked: false, opacity: 1, x: 0, y: 0, width: 1200, height: 1200, rotation: 0, fill: { type: 'solid', color: getBrandColor('cloud') } },
      { type: 'text', name: 'Big Number', visible: true, locked: false, opacity: 1, x: 100, y: 300, width: 1000, height: 200, rotation: 0, content: '93%', fontSize: 180, fontWeight: 700, textAlign: 'center', color: getBrandColor('brand-primary'), letterSpacing: -0.04, lineHeight: 1.0, textTransform: 'none' },
      { type: 'text', name: 'Description', visible: true, locked: false, opacity: 1, x: 200, y: 530, width: 800, height: 80, rotation: 0, content: 'of candidates placed within 2 weeks', fontSize: 28, fontWeight: 400, textAlign: 'center', color: getBrandColor('charcoal'), letterSpacing: -0.01, lineHeight: 1.4, textTransform: 'none' },
      { type: 'shape', name: 'Accent Line', visible: true, locked: false, opacity: 1, x: 500, y: 640, width: 200, height: 4, rotation: 0, shape: 'pill', fill: getBrandColor('ember-500'), borderRadius: 9999 },
      { type: 'text', name: 'Company', visible: true, locked: false, opacity: 1, x: 400, y: 1050, width: 400, height: 30, rotation: 0, content: BRAND.website, fontSize: 16, fontWeight: 500, textAlign: 'center', color: getBrandColor('charcoal-60'), letterSpacing: 0.02, lineHeight: 1.4, textTransform: 'none' },
    ]),
  },
  {
    id: 'story-cta',
    name: 'Story CTA',
    category: 'general',
    description: 'Instagram/Facebook story with bold CTA',
    formatId: 'instagram-story',
    create: () => makeDoc('Story CTA', 'instagram-story', [
      { type: 'background', name: 'Background', visible: true, locked: false, opacity: 1, x: 0, y: 0, width: 1080, height: 1920, rotation: 0, fill: { type: 'gradient', gradientType: 'linear', angle: 180, stops: [{ position: 0, color: getBrandColor('brand-dark') }, { position: 0.6, color: getBrandColor('teal-900') }, { position: 1, color: getBrandColor('charcoal') }] } },
      { type: 'text', name: 'Headline', visible: true, locked: false, opacity: 1, x: 80, y: 600, width: 920, height: 200, rotation: 0, content: 'Your next career move starts here', fontSize: 52, fontWeight: 700, textAlign: 'left', color: getBrandColor('white'), letterSpacing: -0.02, lineHeight: 1.2, textTransform: 'none' },
      { type: 'text', name: 'Body', visible: true, locked: false, opacity: 1, x: 80, y: 840, width: 800, height: 80, rotation: 0, content: 'AI-powered recruitment that understands what you\'re actually looking for.', fontSize: 22, fontWeight: 400, textAlign: 'left', color: getBrandColor('brand-accent'), letterSpacing: 0, lineHeight: 1.5, textTransform: 'none' },
      { type: 'shape', name: 'CTA Button', visible: true, locked: false, opacity: 1, x: 80, y: 1400, width: 400, height: 64, rotation: 0, shape: 'pill', fill: getBrandColor('ember-500'), borderRadius: 9999 },
      { type: 'text', name: 'CTA Text', visible: true, locked: false, opacity: 1, x: 120, y: 1412, width: 320, height: 40, rotation: 0, content: `${BRAND.ai.callToAction} →`, fontSize: 20, fontWeight: 600, textAlign: 'center', color: getBrandColor('white'), letterSpacing: 0, lineHeight: 1.4, textTransform: 'none' },
    ]),
  },
  {
    id: 'minimal-banner',
    name: 'Minimal Banner',
    category: 'general',
    description: 'Clean banner format with tagline',
    formatId: 'generic-banner',
    create: () => makeDoc('Minimal Banner', 'generic-banner', [
      { type: 'background', name: 'Background', visible: true, locked: false, opacity: 1, x: 0, y: 0, width: 1200, height: 300, rotation: 0, fill: { type: 'solid', color: getBrandColor('paper') } },
      { type: 'text', name: 'Headline', visible: true, locked: false, opacity: 1, x: 60, y: 90, width: 800, height: 60, rotation: 0, content: 'Recruitment, reimagined.', fontSize: 40, fontWeight: 600, textAlign: 'left', color: getBrandColor('charcoal'), letterSpacing: -0.02, lineHeight: 1.2, textTransform: 'none' },
      { type: 'text', name: 'Tagline', visible: true, locked: false, opacity: 1, x: 60, y: 165, width: 600, height: 30, rotation: 0, content: 'Design once. Export to every format.', fontSize: 16, fontWeight: 400, textAlign: 'left', color: getBrandColor('charcoal-60'), letterSpacing: 0, lineHeight: 1.4, textTransform: 'none' },
      { type: 'shape', name: 'Accent', visible: true, locked: false, opacity: 1, x: 60, y: 210, width: 60, height: 4, rotation: 0, shape: 'pill', fill: getBrandColor('ember-500'), borderRadius: 9999 },
    ]),
  },
]

export const TEMPLATE_CATEGORIES = [
  { id: 'hiring', label: 'Hiring' },
  { id: 'employer-brand', label: 'Employer Brand' },
  { id: 'event', label: 'Events' },
  { id: 'testimonial', label: 'Testimonials' },
  { id: 'general', label: 'General' },
]
