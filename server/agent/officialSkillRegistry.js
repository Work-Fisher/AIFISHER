import {
  OFFICIAL_DRAMA_SKILL_METADATA,
  OFFICIAL_PRODUCTION_SKILLS,
  readOfficialDramaInstructions,
} from './drama/officialDramaBundle.js';

export const DEFAULT_OFFICIAL_SKILL_SLUG = OFFICIAL_DRAMA_SKILL_METADATA.slug;

const BUNDLED_SKILLS = Object.freeze(OFFICIAL_PRODUCTION_SKILLS.map(metadata => Object.freeze({ metadata, readInstructions: () => readOfficialDramaInstructions(metadata.bundleId) })));

/** Only trusted bundled code registers official skills; imports never populate this registry. */
export function createOfficialSkillRegistry(entries = BUNDLED_SKILLS) {
  const registry = new Map();
  for (const entry of entries) {
    const metadata = entry?.metadata;
    if (!metadata || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(metadata.slug)
      || metadata.slug.startsWith('local--') || registry.has(metadata.slug)
      || typeof metadata.version !== 'string' || !metadata.version
      || typeof entry.readInstructions !== 'function') {
      throw new TypeError('官方 SKILL 注册信息无效或重复');
    }
    registry.set(metadata.slug, {
      metadata: Object.freeze({ ...metadata, openness: metadata.openness === 'closed' ? 'closed' : 'open', source: 'official', readOnly: true }),
      readInstructions: entry.readInstructions,
    });
  }
  return Object.freeze({
    list: () => [...registry.values()].map(({ metadata }) => ({ ...metadata })),
    readInstructions: async (slug, context) => {
      const skill = registry.get(slug);
      if (!skill) throw new Error('官方 SKILL 尚未就绪');
      return skill.readInstructions(context);
    },
  });
}
