export interface OfficialProductionProfile {
  readonly id: string; readonly slug: string; readonly name: string; readonly version: string;
  readonly mode: 'script' | 'assets'; readonly webAppId: string;
}
export const OFFICIAL_PRODUCTION_PROFILES: readonly OfficialProductionProfile[];
export function productionProfileForSkill(slug: string | null | undefined): OfficialProductionProfile | undefined;
export function productionProfileForBundle(id: string | null | undefined): OfficialProductionProfile | undefined;
