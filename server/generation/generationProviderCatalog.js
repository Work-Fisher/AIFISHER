import { LibTvCliImageProvider, LibTvCliVideoProvider } from '../providers/libTvCliProvider.js';
import { AliyunVideoProvider } from '../providers/aliyunProvider.js';
import { SeedVr2ImageProvider } from '../providers/seedVr2Provider.js';
import { DeepSeekProvider } from '../providers/deepseekProvider.js';
import {
  DreaminaCliImageProvider,
  DreaminaCliVideoProvider,
} from '../providers/dreaminaCliProvider.js';
import {
  DoubaoImageProvider,
  DoubaoTextProvider,
  DoubaoVideoProvider,
} from '../providers/doubaoProvider.js';
import { GptImageProvider, GptTextProvider } from '../providers/gptProvider.js';
import { GrokVideoProvider } from '../providers/grokProvider.js';
import { JimengImageProvider } from '../providers/jimengProvider.js';
import { KlingVideoProvider } from '../providers/klingProvider.js';
import { MurekaAudioProvider } from '../providers/murekaProvider.js';
import { GlmTextProvider, KimiTextProvider } from '../providers/officialTextProvider.js';
import {
  RelayAudioProvider,
  RelayImageProvider,
  RelayMidjourneyProvider,
  RelayMusicProvider,
  RelayTextProvider,
  RelayVideoProvider,
} from '../providers/relayProvider.js';
import {
  RunningHubGlobalImageProvider,
  RunningHubGlobalVideoProvider,
  RunningHubImageProvider,
  RunningHubVideoProvider,
} from '../providers/runninghubProvider.js';

function contract(name, handler, kinds, execution, requiredSecrets) {
  return Object.freeze({
    name,
    handler,
    kinds: Object.freeze([...kinds]),
    execution,
    requiredSecrets: Object.freeze([...requiredSecrets]),
  });
}

export const GENERATION_PROVIDER_CONTRACTS = Object.freeze([
  contract('SeedVr2ImageProvider', SeedVr2ImageProvider, ['image'], 'polling', ['RUNNINGHUB_API_KEY']),
  contract('DoubaoTextProvider', DoubaoTextProvider, ['text'], 'immediate', ['ARK_API_KEY']),
  contract('GptTextProvider', GptTextProvider, ['text'], 'immediate', ['OPENAI_API_KEY']),
  contract('DeepSeekProvider', DeepSeekProvider, ['text'], 'immediate', ['DEEPSEEK_API_KEY']),
  contract('GlmTextProvider', GlmTextProvider, ['text'], 'immediate', ['ZHIPU_API_KEY']),
  contract('KimiTextProvider', KimiTextProvider, ['text'], 'immediate', ['MOONSHOT_API_KEY']),
  contract(
    'JimengImageProvider',
    JimengImageProvider,
    ['image'],
    'polling',
    ['JIMENG_ACCESS_KEY', 'JIMENG_SECRET_KEY'],
  ),
  contract('DoubaoImageProvider', DoubaoImageProvider, ['image'], 'immediate', ['ARK_API_KEY']),
  contract('LibTvCliImageProvider', LibTvCliImageProvider, ['image'], 'polling', []),
  contract('LibTvCliVideoProvider', LibTvCliVideoProvider, ['video'], 'polling', []),
  contract('DreaminaCliImageProvider', DreaminaCliImageProvider, ['image'], 'polling', []),
  contract('GptImageProvider', GptImageProvider, ['image'], 'immediate', ['OPENAI_API_KEY']),
  contract(
    'RunningHubImageProvider',
    RunningHubImageProvider,
    ['image'],
    'polling',
    ['RUNNINGHUB_API_KEY'],
  ),
  // RH AI站是与 CN 站彼此独立的账号，密钥不通用，所以它是自己的一份契约。
  contract(
    'RunningHubGlobalImageProvider',
    RunningHubGlobalImageProvider,
    ['image'],
    'polling',
    ['RUNNINGHUB_GLOBAL_API_KEY'],
  ),
  contract('RelayImageProvider', RelayImageProvider, ['image'], 'polling', ['RELAY_API_KEY']),
  contract(
    'RelayMidjourneyProvider',
    RelayMidjourneyProvider,
    ['image'],
    'polling',
    ['RELAY_API_KEY'],
  ),
  contract('RelayVideoProvider', RelayVideoProvider, ['video'], 'polling', ['RELAY_API_KEY']),
  contract('RelayTextProvider', RelayTextProvider, ['text'], 'immediate', ['RELAY_API_KEY']),
  contract('RelayAudioProvider', RelayAudioProvider, ['audio'], 'polling', ['RELAY_API_KEY']),
  contract('RelayMusicProvider', RelayMusicProvider, ['audio'], 'polling', ['RELAY_API_KEY']),
  contract('MurekaAudioProvider', MurekaAudioProvider, ['audio'], 'polling', ['MUREKA_API_KEY']),
  contract('DoubaoVideoProvider', DoubaoVideoProvider, ['video'], 'polling', ['ARK_API_KEY']),
  contract('DreaminaCliVideoProvider', DreaminaCliVideoProvider, ['video'], 'polling', []),
  contract(
    'KlingVideoProvider',
    KlingVideoProvider,
    ['video'],
    'polling',
    ['KLING_ACCESS_KEY', 'KLING_SECRET_KEY'],
  ),
  contract('AliyunVideoProvider', AliyunVideoProvider, ['video'], 'polling', ['ALIYUN_API_KEY']),
  contract(
    'RunningHubVideoProvider',
    RunningHubVideoProvider,
    ['video'],
    'polling',
    ['RUNNINGHUB_API_KEY'],
  ),
  // 「全能视频」整族（Grok / Veo / S）已从 CN 站迁到 RH AI站，和图片那批一样，
  // 走另一把密钥另一个域名——不能挂在 RunningHubVideoProvider 上。
  contract(
    'RunningHubGlobalVideoProvider',
    RunningHubGlobalVideoProvider,
    ['video'],
    'polling',
    ['RUNNINGHUB_GLOBAL_API_KEY'],
  ),
  contract('GrokVideoProvider', GrokVideoProvider, ['video'], 'polling', ['GROK_API_KEY']),
]);

const PROVIDERS_BY_NAME = new Map(
  GENERATION_PROVIDER_CONTRACTS.map((providerContract) => [
    providerContract.name,
    providerContract.handler,
  ]),
);

export function getGenerationProvider(providerName) {
  return PROVIDERS_BY_NAME.get(providerName) || null;
}
