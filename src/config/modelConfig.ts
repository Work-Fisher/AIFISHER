import { NodeType } from '../types';

/**
 * 图像画质比例
 */
export const IMAGE_RESOLUTIONS = ["512", "1K", "2K", "4K"];
export const IMAGE_RATIOS = ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "5:4", "4:5", "21:9", "1:4", "1:8", "4:1", "8:1", "2:1"];
/**
 * 视频画质比例
 */
export const VIDEO_RESOLUTIONS   = ["480p", "720p", "1080p"];
export const VIDEO_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "5:4", "4:5", "21:9"];

/**
 * 文本频画质比例
 */
export const TEXT_RESOLUTIONS = [];
export const TEXT_ASPECT_RATIOS = [];

/**
 * 文本模型配置
 * maxInputs: 最大连线数量
 * languageModes: 模式配置，包含该模式下允许的输入类型及数量
 * cost: 生成开销
 */
export const TEXT_MODELS = [
    {
        name:                       '豆包大语言2.0-mini',
        description:                '低成本、高并发、多模态极致速度',
        timeEstimate:               '2min',
        provider:                   'DoubaoTextProvider',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        supportedImageFormats:      ['jpeg', 'png', 'webp', 'bmp', 'tiff'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0.01,
        languageModes: [
            { label: '多模态对话', value: 'multimodal-chat', allowedInputs: { 'text': 10, 'image': 10, 'video': 1 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                model: 'doubao-seed-2-0-mini-260428'
            }
        },
        advancedParams: [
            {
                key: 'reasoning', label: '思考强度', type: 'select', default: 'minimal', options: [
                    { label: '高', value: 'high' },
                    { label: '中等', value: 'medium' },
                    { label: '低', value: 'low' },
                    { label: '关闭', value: 'minimal' }
                ]
            },
            {
                key: 'detail', label: '图片细节', type: 'select', default: 'low', options: [
                    { label: '超高', value: 'xhigh' },
                    { label: '高', value: 'high' },
                    { label: '低', value: 'low' }
                ]
            }
        ]
    },
    {
        name:                       '豆包大语言2.0-lite',
        description:                '豆包 2.0 lite 官方多模态大语言模型，费用以官方账单为准',
        timeEstimate:               '2min',
        provider:                   'DoubaoTextProvider',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        supportedImageFormats:      ['jpeg', 'png', 'webp', 'bmp', 'tiff'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                [],
        aspectRatios:               [],
        languageModes: [
            { label: '多模态对话', value: 'multimodal-chat', allowedInputs: { 'text': 10, 'image': 10, 'video': 1 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                model: 'doubao-seed-2-0-lite-260428'
            }
        },
        advancedParams: [
            {
                key: 'reasoning', label: '思考强度', type: 'select', default: 'medium', options: [
                    { label: '高', value: 'high' },
                    { label: '中等', value: 'medium' },
                    { label: '低', value: 'low' },
                    { label: '关闭', value: 'minimal' }
                ]
            },
            {
                key: 'detail', label: '图片细节', type: 'select', default: 'low', options: [
                    { label: '超高', value: 'xhigh' },
                    { label: '高', value: 'high' },
                    { label: '低', value: 'low' }
                ]
            }
        ]
    },
    {
        name:                       '豆包大语言2.1-pro',
        description:                '豆包 2.1 pro 官方多模态大语言模型，费用以官方账单为准',
        timeEstimate:               '2min',
        provider:                   'DoubaoTextProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        supportedImageFormats:      ['jpeg', 'png', 'webp', 'bmp', 'tiff'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                [],
        aspectRatios:               [],
        languageModes: [
            { label: '多模态对话', value: 'multimodal-chat', allowedInputs: { 'text': 10, 'image': 10, 'video': 1 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                model: 'doubao-seed-2-1-pro-260628'
            }
        },
        advancedParams: [
            {
                key: 'reasoning', label: '思考强度', type: 'select', default: 'high', options: [
                    { label: '高', value: 'high' },
                    { label: '中等', value: 'medium' },
                    { label: '低', value: 'low' },
                    { label: '关闭', value: 'minimal' }
                ]
            },
            {
                key: 'detail', label: '图片细节', type: 'select', default: 'low', options: [
                    { label: '超高', value: 'xhigh' },
                    { label: '高', value: 'high' },
                    { label: '低', value: 'low' }
                ]
            }
        ]
    },
    {
        name:                       '豆包大语言2.1-turbo',
        description:                '豆包 2.1 turbo 官方多模态大语言模型，费用以官方账单为准',
        timeEstimate:               '2min',
        provider:                   'DoubaoTextProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        supportedImageFormats:      ['jpeg', 'png', 'webp', 'bmp', 'tiff'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                [],
        aspectRatios:               [],
        languageModes: [
            { label: '多模态对话', value: 'multimodal-chat', allowedInputs: { 'text': 10, 'image': 10, 'video': 1 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                model: 'doubao-seed-2-1-turbo-260628'
            }
        },
        advancedParams: [
            {
                key: 'reasoning', label: '思考强度', type: 'select', default: 'high', options: [
                    { label: '高', value: 'high' },
                    { label: '中等', value: 'medium' },
                    { label: '低', value: 'low' },
                    { label: '关闭', value: 'minimal' }
                ]
            },
            {
                key: 'detail', label: '图片细节', type: 'select', default: 'low', options: [
                    { label: '超高', value: 'xhigh' },
                    { label: '高', value: 'high' },
                    { label: '低', value: 'low' }
                ]
            }
        ]
    },
    {
        name:                       '豆包大语言2.0-pro',
        description:                '高性能、高精度、多模态深度推理',
        timeEstimate:               '2min',
        provider:                   'DoubaoTextProvider',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        supportedImageFormats:      ['jpeg', 'png', 'webp', 'bmp', 'tiff'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0.05,
        languageModes: [
            { label: '多模态对话', value: 'multimodal-chat', allowedInputs: { 'text': 10, 'image': 10, 'video': 1 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                model: 'doubao-seed-2-0-pro-260215'
            }
        },
        advancedParams: [
            {
                key: 'reasoning', label: '思考强度', type: 'select', default: 'minimal', options: [
                    { label: '高', value: 'high' },
                    { label: '中等', value: 'medium' },
                    { label: '低', value: 'low' },
                    { label: '关闭', value: 'minimal' }
                ]
            },
            {
                key: 'detail', label: '图片细节', type: 'select', default: 'low', options: [
                    { label: '超高', value: 'xhigh' },
                    { label: '高', value: 'high' },
                    { label: '低', value: 'low' }
                ]
            }
        ]
    },
    {
        name:                       'DeepSeek-V4-Flash',
        description:                '极速文本推理与深度思考，不支持图片或视频输入',
        timeEstimate:               '1min',
        provider:                   'DeepSeekProvider',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text'],
        supportedImageFormats:      [],
        maxImageSizeMb:             0,
        maxResolution:              '',
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0.02,
        languageModes: [
            { label: '文本对话', value: 'multimodal-chat', allowedInputs: { 'text': 10 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://api.deepseek.com/chat/completions',
                model: 'deepseek-v4-flash'
            }
        },
        advancedParams: [
            {
                key: 'reasoning_effort', label: '思考强度', type: 'select', default: 'high', options: [
                    { label: '低', value: 'low' },
                    { label: '高', value: 'high' },
                    { label: '最高', value: 'max' }
                ]
            }]
    },
    {
        name:                       'DeepSeek-V4-Pro',
        description:                '高性能文本推理与深度思考，不支持图片或视频输入',
        timeEstimate:               '1min',
        provider:                   'DeepSeekProvider',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text'],
        supportedImageFormats:      [],
        maxImageSizeMb:             0,
        maxResolution:              '',
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0.025,
        languageModes: [
            { label: '文本对话', value: 'multimodal-chat', allowedInputs: { 'text': 10 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://api.deepseek.com/chat/completions',
                model: 'deepseek-v4-pro'
            }
        },
        advancedParams: [
            {
                key: 'reasoning_effort', label: '思考强度', type: 'select', default: 'high', options: [
                    { label: '低', value: 'low' },
                    { label: '高', value: 'high' },
                    { label: '最高', value: 'max' }
                ]
            }]
    },
    {
        name:                       'DeepSeek-V4.1-Flash',
        description:                'DeepSeek V4.1 Flash 文本推理与深度思考，不支持图片或视频输入。',
        timeEstimate:               '1min',
        provider:                   'DeepSeekProvider',
        source:                     'official',
        canonicalModel:             'DeepSeek-V4.1-Flash',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text'],
        supportedImageFormats:      [],
        maxImageSizeMb:             0,
        maxResolution:              '',
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按官方 Token 账单结算' }
        },
        languageModes: [
            { label: '文本对话', value: 'multimodal-chat', allowedInputs: { 'text': 10 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://api.deepseek.com/chat/completions',
                model: 'deepseek-flash'
            }
        },
        advancedParams: [
            {
                key: 'reasoning_effort', label: '思考强度', type: 'select', default: 'high', options: [
                    { label: '低', value: 'low' },
                    { label: '高', value: 'high' },
                    { label: '最高', value: 'max' }
                ]
            }
        ]
    },
    {
        name:                       'DeepSeek-V4-Flash-Vision-Exp',
        description:                'DeepSeek 官方实验性视觉理解模型；支持图片、截图与图表分析，不生成图片。',
        timeEstimate:               '1min',
        provider:                   'DeepSeekProvider',
        source:                     'official',
        canonicalModel:             'DeepSeek-V4-Flash-Vision-Exp',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'gif', 'webp'],
        maxImageSizeMb:             32,
        maxResolution:              '8192*8192',
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按官方峰/谷 Token 账单结算（图片折算为输入 Token）' }
        },
        languageModes: [
            { label: '视觉理解', value: 'multimodal-chat', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'multimodal-chat': {
                url: 'https://api.deepseek.com/chat/completions',
                model: 'deepseek-v4-flash-vision-exp'
            }
        },
        advancedParams: [
            {
                key: 'reasoning_effort', label: '思考强度', type: 'select', default: 'high', options: [
                    { label: '低', value: 'low' },
                    { label: '高', value: 'high' },
                    { label: '最高', value: 'max' }
                ]
            },
            {
                key: 'detail', label: '图片细节', type: 'select', default: 'auto', options: [
                    { label: '自动', value: 'auto' },
                    { label: '原图', value: 'original' },
                    { label: '低（更快）', value: 'low' }
                ]
            }
        ]
    },
    {
        name:                       'GLM 5.3',
        description:                '智谱 GLM 5.3 官方直连；支持低、高、最大三档思考强度。',
        timeEstimate:               '2min',
        provider:                   'GlmTextProvider',
        source:                     'official',
        canonicalModel:             'GLM 5.3',
        brand:                      'GLM',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按官方 Token 账单结算' }
        },
        languageModes: [
            { label: '文本对话', value: 'multimodal-chat', allowedInputs: { 'text': 10 } }
        ],
        endpoint: {
            'multimodal-chat': { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-5.3' }
        },
        advancedParams: [
            {
                key: 'reasoning_effort', label: '思考强度', type: 'select', default: 'max', options: [
                    { label: '低', value: 'low' },
                    { label: '高', value: 'high' },
                    { label: '最大', value: 'max' }
                ]
            }
        ]
    },
    {
        name:                       'GLM 5.3 Flash',
        description:                '智谱 GLM 5.3 Flash 官方直连；低延迟、高性价比。',
        timeEstimate:               '1min',
        provider:                   'GlmTextProvider',
        source:                     'official',
        canonicalModel:             'GLM 5.3 Flash',
        brand:                      'GLM',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'gif', 'webp'],
        maxImageSizeMb:             32,
        maxResolution:              '8192*8192',
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按官方 Token 账单结算' }
        },
        languageModes: [
            { label: '多模态对话', value: 'multimodal-chat', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'multimodal-chat': { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-5.3-flash' }
        },
        advancedParams: [
            {
                key: 'reasoning_effort', label: '思考强度', type: 'select', default: 'max', options: [
                    { label: '低', value: 'low' },
                    { label: '高', value: 'high' },
                    { label: '最大', value: 'max' }
                ]
            }
        ]
    },
    {
        name:                       'Kimi K3',
        description:                'Kimi 官方直连；按官方输入与输出 Token 账单结算。',
        timeEstimate:               '2min',
        provider:                   'KimiTextProvider',
        source:                     'official',
        canonicalModel:             'Kimi K3',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按官方 Token 账单结算' }
        },
        languageModes: [
            { label: '图文对话', value: 'multimodal-chat', allowedInputs: { 'text': 10, 'image': 9 } }
        ],
        endpoint: {
            'multimodal-chat': { url: 'https://api.moonshot.cn/v1/chat/completions', model: 'kimi-k3' }
        },
        advancedParams: [
            {
                key: 'reasoning_effort', label: '思考强度', type: 'select', default: 'max', options: [
                    { label: '低', value: 'low' },
                    { label: '高', value: 'high' },
                    { label: '最高', value: 'max' }
                ]
            }
        ]
    },
    {
        name:                       '豆包 Seed Evolving · API',
        description:                'AIFISHER Agent 中转线路；公开 Chat Completions 路由，按输入与输出 Token 动态计费。',
        timeEstimate:               '2min',
        provider:                   'RelayTextProvider',
        source:                     'relay',
        canonicalModel:             '豆包 Seed Evolving',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  3,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按输入/输出 Token 动态计费' }
        },
        languageModes: [
            { label: '多模态对话', value: 'multimodal-chat', allowedInputs: { 'text': 1, 'image': 1, 'video': 1 } }
        ],
        endpoint: {
            'multimodal-chat': { url: 'https://api.work-fisher.com/v1/chat/completions', model: 'bytedance/doubao-seed-evolving' }
        },
        advancedParams: []
    },
    {
        name:                       'DeepSeek V4 Flash · API',
        selectable:                 false,
        description:                'AIFISHER Agent 中转线路；公开 Chat Completions 路由，按输入与输出 Token 动态计费。',
        timeEstimate:               '2min',
        provider:                   'RelayTextProvider',
        source:                     'relay',
        canonicalModel:             'DeepSeek-V4-Flash',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  1,
        supportedReferenceTypes:    ['text'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按输入/输出 Token 动态计费' }
        },
        languageModes: [
            { label: '文本对话', value: 'multimodal-chat', allowedInputs: { 'text': 1 } }
        ],
        endpoint: {
            'multimodal-chat': { url: 'https://api.work-fisher.com/v1/chat/completions', model: 'deepseek/deepseek-v4-flash' }
        },
        advancedParams: []
    },
    {
        name:                       'DeepSeek V4 Pro · API',
        selectable:                 false,
        description:                'AIFISHER Agent 中转线路；公开 Chat Completions 路由，按输入与输出 Token 动态计费。',
        timeEstimate:               '2min',
        provider:                   'RelayTextProvider',
        source:                     'relay',
        canonicalModel:             'DeepSeek-V4-Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  1,
        supportedReferenceTypes:    ['text'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按输入/输出 Token 动态计费' }
        },
        languageModes: [
            { label: '文本对话', value: 'multimodal-chat', allowedInputs: { 'text': 1 } }
        ],
        endpoint: {
            'multimodal-chat': { url: 'https://api.work-fisher.com/v1/chat/completions', model: 'deepseek/deepseek-v4-pro' }
        },
        advancedParams: []
    },
    {
        name:                       'GLM 5.3 Flash · API',
        description:                'AIFISHER API 中转线路；支持文字与图片理解，按输入与输出 Token 动态计费。',
        timeEstimate:               '1min',
        provider:                   'RelayTextProvider',
        source:                     'relay',
        canonicalModel:             'GLM 5.3 Flash',
        brand:                      'GLM',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  2,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按输入/输出 Token 动态计费' }
        },
        languageModes: [
            { label: '多模态对话', value: 'multimodal-chat', allowedInputs: { 'text': 1, 'image': 1 } }
        ],
        endpoint: {
            'multimodal-chat': { url: 'https://api.work-fisher.com/v1/chat/completions', model: 'glm/glm-5.3-flash' }
        },
        advancedParams: []
    },
    {
        name:                       'Kimi K3 · API',
        selectable:                 false,
        description:                'AIFISHER Agent 中转线路；公开 Chat Completions 路由，按输入与输出 Token 动态计费。',
        timeEstimate:               '2min',
        provider:                   'RelayTextProvider',
        source:                     'relay',
        canonicalModel:             'Kimi K3',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  1,
        supportedReferenceTypes:    ['text'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0,
        priceTextByMode: {
            'multimodal-chat': { 'default': '按输入/输出 Token 动态计费' }
        },
        languageModes: [
            { label: '文本对话', value: 'multimodal-chat', allowedInputs: { 'text': 1 } }
        ],
        endpoint: {
            'multimodal-chat': { url: 'https://api.work-fisher.com/v1/chat/completions', model: 'kimi-k3' }
        },
        advancedParams: []
    }
];

/**
 * 图像模型配置
 * maxInputs: 最大连线数量
 * imageModes: 模式配置，包含该模式下允许的输入类型及数量
 * aspectRatios: 支持的比例
 * resolutions: 支持的分辨率
 * cost: 生成开销
 */
export const IMAGE_MODELS = [
    {
        name: 'Lib Image 2.5 Fast · LibTV CLI', brand: 'Lib Image',
        description: '使用当前画布账号绑定的 LibTV CLI，按 LibTV 积分账单扣费。',
        timeEstimate: '30min', provider: 'LibTvCliImageProvider', source: 'libtv_cli',
        canonicalModel: 'Lib Image 2.5 Fast', maxConcurrent: 1, useProxy: false,
        maxInputs: 14, supportedReferenceTypes: ['text', 'image'],
        supportedImageFormats: ['jpeg', 'png', 'webp'], maxImageSizeMb: 25,
        resolutions: ['1K', '2K', '4K'],
        aspectRatios: ['1:1','1:2','2:1','9:16','16:9','3:4','4:3','3:2','2:3','5:4','4:5','21:9','9:21'],
        cost: 0,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { text: 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { text: 10, image: 14 } }
        ],
        endpoint: {
            'text-to-image': { url: 'local:libtv-cli', model: 'Lib Image 2.5 Fast' },
            'image-to-image': { url: 'local:libtv-cli', model: 'Lib Image 2.5 Fast' }
        },
        advancedParams: [{ key: 'generateCount', label: '生成数量', type: 'select', default: 1, options: [{ label: '1', value: 1 }, { label: '2', value: 2 }, { label: '4', value: 4 }] }]
    },
    {
        name:                       'Seedream 5.0 Pro · 即梦 CLI',
        brand:                      'Seedream',
        description:                '使用当前账号登录的即梦 CLI；按即梦积分账单扣费，1K 档会按 CLI 的 1.5K 档提交。',
        timeEstimate:               '15min',
        provider:                   'DreaminaCliImageProvider',
        source:                     'dreamina_cli',
        canonicalModel:             'Seedream v5 Pro',
        maxConcurrent:              1,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             25,
        maxResolution:              '6240*6240',
        resolutions:                ['1K', '2K', '4K'],
        aspectRatios:               ['1:1', '2:3', '3:2', '9:16', '16:9', '3:4', '4:3', '21:9'],
        cost:                       0,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image': { url: 'local:dreamina-cli', model: '5.0Pro' },
            'image-to-image': { url: 'local:dreamina-cli', model: '5.0Pro' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 10 }
        ]
    },
    {
        name:                       '即梦图片3.0',
        description:                '影视质感,文字更准',
        timeEstimate:               '1min',
        provider:                   'JimengImageProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png'],
        maxImageSizeMb:             4.7,
        maxResolution:              '4096*4096',
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
        cost: {
            "512": 0.2,
            "1K": 0.2,
            "2K": 0.2,
            "4K": 0.2
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 1 } }
        ],
        endpoint: {
            'text-to-image': {
                url: 'https://visual.volcengineapi.com/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31',
                model: 'jimeng_t2i_v30'
            },
            'image-to-image': {
                url: 'https://visual.volcengineapi.com/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31',
                model: 'jimeng_i2i_v30'
            }
        },
        advancedParams: [
            { key: 'use_pre_llm', label: '提示词优化', type: 'toggle', default: true },
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       '即梦图片3.1',
        description:                '丰富的美学多样性,画面鲜明生动',
        timeEstimate:               '1min',
        provider:                   'JimengImageProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text'],
        supportedImageFormats:      [],
        maxImageSizeMb:             0,
        maxResolution:              '',
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
        cost: {
            "512": 0.2,
            "1K": 0.2,
            "2K": 0.2,
            "4K": 0.2
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } }
        ],
        endpoint: {
            'text-to-image': {
                url: 'https://visual.volcengineapi.com/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31',
                model: 'jimeng_t2i_v31'
            }
        },
        advancedParams: [
            { key: 'use_pre_llm', label: '提示词优化', type: 'toggle', default: true },
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       '豆包图片4.0(多参考)',
        description:                '美感、匹配、一致与速度',
        timeEstimate:               '1min',
        provider:                   'DoubaoImageProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp', 'bmp', 'tiff'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
        cost: {
            "512": 0.2,
            "1K": 0.2,
            "2K": 0.2,
            "4K": 0.2
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10} }
        ],
        endpoint: {
            'text-to-image': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
                model: 'doubao-seedream-4-0-250828'
            },
            'image-to-image': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
                model: 'doubao-seedream-4-0-250828'
            }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 4 }
        ]
    },
    {
        name:                       '豆包图片4.5(多参考)',
        description:                '美感、匹配、一致与速度++',
        timeEstimate:               '1min',
        provider:                   'DoubaoImageProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp', 'bmp', 'tiff'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                ["2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
        cost: {
            "512": 0.25,
            "1K": 0.25,
            "2K": 0.25,
            "4K": 0.25
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
                model: 'doubao-seedream-4-5-251128'
            },
            'image-to-image': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
                model: 'doubao-seedream-4-5-251128'
            }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 4 }
        ]
    },
    {
        name:                       '豆包图片5.0-lite',
        description:                '知识广、一致性、支持联网搜索',
        timeEstimate:               '1min',
        provider:                   'DoubaoImageProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp', 'bmp', 'tiff'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                ["2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
        cost: {
            "512": 0.22,
            "1K": 0.22,
            "2K": 0.22,
            "4K": 0.22
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
                model: 'doubao-seedream-5-0-260128'
            },
            'image-to-image': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
                model: 'doubao-seedream-5-0-260128'
            }
        },
        advancedParams: [
            { key: 'web_search', label: '联网搜索', type: 'toggle', default: false },
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 4 }
        ]
    },
    {
        name:                       'GPT Image 2',
        canonicalModel:             'GPT Image 2',
        description:                'GPT 强力图像生成模型',
        timeEstimate:               '2min',
        provider:                   'GptImageProvider',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             10,
        maxResolution:              '4096*4096',
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "5:4", "4:5", "21:9", "2:1"],
        cost: {
            "1K": 0.20,
            "2K": 0.30,
            "4K": 0.75
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } },
            { label: '遮罩修图', value: 'image-inpainting', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-image': {
                url: 'https://api.openai.com/v1/images/generations',
                model: 'gpt-image-2'
            },
            'image-to-image': {
                url: 'https://api.openai.com/v1/images/edits',
                model: 'gpt-image-2'
            },
            'image-inpainting': {
                url: 'https://api.openai.com/v1/images/edits',
                model: 'gpt-image-2'
            }
        },
        advancedParams: [
            {
                key: 'quality', label: '生成质量', type: 'select', default: 'auto', options: [
                    { label: '自动', value: 'auto' },
                    { label: '低', value: 'low' },
                    { label: '中', value: 'medium' },
                    { label: '高', value: 'high' }
                ]
            },
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 4 }
        ]
    },
// ========================================================================
    // AIFISHER API（api.work-fisher.com）
    //
    // 与官方各家、RunningHub 三者完全隔离：独立密钥 RELAY_API_KEY、独立地址、
    // 独立适配器。canonicalModel 把同一个模型的不同来源归到一组，
    // 画布里一级选模型、二级选来源。
    // cost 是控制台 /api/pricing 的实测成交价（¥/张），不是文档牌价。
    // ========================================================================
    {
        name: "GPT Image 2.5 · API 低价扩展版",
        canonicalModel: "GPT Image 2.5",
        variantLabel: "低价扩展版",
        description: "低价扩展版。上游正在灰度升级，实际模型版本随账号升级进度而定。",
        provider: "RelayImageProvider",
        source: "relay",
        maxConcurrent: 0,
        useProxy: false,
        maxInputs: 15,
        supportedReferenceTypes: ["text","image"],
        supportedImageFormats: ["jpeg","png","webp"],
        maxImageSizeMb: 20,
        resolutions: ["1K","2K","4K"],
        aspectRatios: ["1:1","2:3","3:2","9:16","16:9","3:4","4:3","5:4","4:5","2:1","1:2","3:1","1:3","21:9","9:21"],
        cost: {"1K":0.05355,"2K":0.126,"4K":0.189},
        imageModes: [{"label":"文生图","value":"text-to-image","allowedInputs":{"text":15}},{"label":"图生图","value":"image-to-image","allowedInputs":{"text":15,"image":15}}],
        endpoint: {"text-to-image":{"url":"https://api.work-fisher.com/v1/image/generations","model":"workfisher-image-g-v2.5-lowprice"},"image-to-image":{"url":"https://api.work-fisher.com/v1/image/generations","model":"workfisher-image-g-v2.5-lowprice"}},
        advancedParams: [{ key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }],
    },
    {
        name: "GPT Image 2.5 · API Flare",
        canonicalModel: "GPT Image 2.5",
        variantLabel: "Flare",
        description: "支持文生图与参考图编辑，适合日常创作与快速迭代。价格为历史最低参考，实际消耗随画质、尺寸和输入变化。",
        provider: "RelayImageProvider",
        source: "relay",
        maxConcurrent: 0,
        useProxy: false,
        maxInputs: 16,
        supportedReferenceTypes: ["text","image"],
        supportedImageFormats: ["jpeg","png","webp"],
        maxImageSizeMb: 20,
        resolutions: ["1K","2K","4K"],
        aspectRatios: ["1:1","2:3","3:2","9:16","16:9","3:4","4:3","5:4","4:5","2:1","1:2","3:1","1:3","21:9","9:21"],
        cost: {"1K":0.097692,"2K":0.14196,"4K":0.703017},
        priceNoteByMode: {"text-to-image":"历史最低参考，实际费用随画质、尺寸及输入变化","image-to-image":"历史最低参考，实际费用随画质、尺寸及输入变化"},
        imageModes: [{"label":"文生图","value":"text-to-image","allowedInputs":{"text":16}},{"label":"图生图","value":"image-to-image","allowedInputs":{"text":16,"image":16}}],
        endpoint: {"text-to-image":{"url":"https://api.work-fisher.com/v1/image/generations","model":"workfisher-image-g-v2.5-flare"},"image-to-image":{"url":"https://api.work-fisher.com/v1/image/generations","model":"workfisher-image-g-v2.5-flare"}},
        advancedParams: [{ key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 },{"key":"quality","label":"画质","type":"select","default":"low","options":[{"label":"auto","value":"auto"},{"label":"low","value":"low"},{"label":"medium","value":"medium"},{"label":"high","value":"high"},{"label":"xhigh","value":"xhigh"},{"label":"max","value":"max"}]},{"key":"output_format","label":"输出格式","type":"select","default":"png","options":[{"label":"png","value":"png"},{"label":"jpeg","value":"jpeg"},{"label":"webp","value":"webp"}]},{"key":"background","label":"背景","type":"select","default":"auto","options":[{"label":"auto","value":"auto"},{"label":"transparent","value":"transparent"},{"label":"opaque","value":"opaque"}]},{"key":"moderation","label":"内容审核","type":"select","default":"low","options":[{"label":"low","value":"low"},{"label":"auto","value":"auto"}]},{"key":"output_compression","label":"压缩质量（JPEG/WebP）","type":"slider","default":100,"min":0,"max":100}],
    },
    {
        name: "GPT Image 2.5 · API Sunburst",
        canonicalModel: "GPT Image 2.5",
        variantLabel: "Sunburst",
        description: "支持文生图与参考图编辑，侧重精细编辑。价格为历史最低参考，实际消耗随画质、尺寸和输入变化。",
        provider: "RelayImageProvider",
        source: "relay",
        maxConcurrent: 0,
        useProxy: false,
        maxInputs: 16,
        supportedReferenceTypes: ["text","image"],
        supportedImageFormats: ["jpeg","png","webp"],
        maxImageSizeMb: 20,
        resolutions: ["1K","2K","4K"],
        aspectRatios: ["1:1","2:3","3:2","9:16","16:9","3:4","4:3","5:4","4:5","2:1","1:2","3:1","1:3","21:9","9:21"],
        cost: {"1K":0.554106,"2K":0.205695,"4K":0.703017},
        priceNoteByMode: {"text-to-image":"历史最低参考，实际费用随画质、尺寸及输入变化","image-to-image":"历史最低参考，实际费用随画质、尺寸及输入变化"},
        imageModes: [{"label":"文生图","value":"text-to-image","allowedInputs":{"text":16}},{"label":"图生图","value":"image-to-image","allowedInputs":{"text":16,"image":16}}],
        endpoint: {"text-to-image":{"url":"https://api.work-fisher.com/v1/image/generations","model":"workfisher-image-g-v2.5-sunburst"},"image-to-image":{"url":"https://api.work-fisher.com/v1/image/generations","model":"workfisher-image-g-v2.5-sunburst"}},
        advancedParams: [{ key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 },{"key":"quality","label":"画质","type":"select","default":"low","options":[{"label":"auto","value":"auto"},{"label":"low","value":"low"},{"label":"medium","value":"medium"},{"label":"high","value":"high"},{"label":"xhigh","value":"xhigh"},{"label":"max","value":"max"}]},{"key":"output_format","label":"输出格式","type":"select","default":"png","options":[{"label":"png","value":"png"},{"label":"jpeg","value":"jpeg"},{"label":"webp","value":"webp"}]},{"key":"background","label":"背景","type":"select","default":"auto","options":[{"label":"auto","value":"auto"},{"label":"transparent","value":"transparent"},{"label":"opaque","value":"opaque"}]},{"key":"moderation","label":"内容审核","type":"select","default":"low","options":[{"label":"low","value":"low"},{"label":"auto","value":"auto"}]},{"key":"output_compression","label":"压缩质量（JPEG/WebP）","type":"slider","default":100,"min":0,"max":100}],
    },
    {
        name:                       'GPT Image 2 · API',
        description:                'AIFISHER API gpt-image-2 满血版。渠道名叫 lowprice，但出图是完整模型，不是降质档',
        timeEstimate:               '5min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'GPT Image 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  16,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { "1K": 0.05, "2K": 0.10, "4K": 0.15 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 16 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 16, 'image': 16 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-g-v2-lowprice' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-g-v2-lowprice' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'GPT Image 2 · API官方高价',
        displayName:                'GPT Image 2 · 网页版满血版',
        premium:                    false,
        variantLabel:               '网页版满血版',
        description:                '网页版满血版，仅支持 1K。通过 AIFISHER API 渠道生成。',
        timeEstimate:               '2min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'GPT Image 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.142 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-g2-t2i' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-g2-i2i' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Grok 2 · API',
        brand:                      'Grok 2',
        description:                'AIFISHER Agent 中转线路 Grok Imagine 2.0，支持文生图与图片编辑',
        timeEstimate:               '2min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Grok 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  3,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K"],
        aspectRatios:               ["1:1", "16:9", "9:16", "3:2", "2:3"],
        cost:                       { "1K": 0.15 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图片编辑', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 3 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-gk-v2' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-gk-v2-edit' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Nano Banana Flash · API',
        description:                'AIFISHER Agent 中转线路 Nano Banana Flash，提示词上限 1000 字',
        timeEstimate:               '1min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Nano Banana Flash',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  14,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { "1K": 0.08 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 14 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 14, 'image': 14 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-nb-flash' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-nb-flash' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Nano Banana 2 Lite · API',
        description:                'AIFISHER API nano-banana-2-lite，可一次出 4 张',
        timeEstimate:               '1min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Nano Banana 2 Lite',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  14,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.08 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 14 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 14, 'image': 14 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-nb-2-lite' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-nb-2-lite' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Nano Banana 2 · API',
        description:                'AIFISHER API nano-banana-2，支持 0.5K 到 4K 与极端比例',
        timeEstimate:               '2min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Nano Banana 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  14,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["512", "1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "21:9", "1:8", "8:1"],
        cost:                       { "512": 0.157, "1K": 0.19, "2K": 0.210, "4K": 0.315 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 14 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 14, 'image': 14 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-nb-2' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-nb-2' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Nano Banana Pro · API',
        description:                'AIFISHER API nano-banana-pro',
        timeEstimate:               '2min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Nano Banana Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  14,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { "1K": 0.28, "2K": 0.315, "4K": 0.525 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 14 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 14, 'image': 14 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-nb-pro' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'workfisher-image-nb-pro' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Seedream 5.0 Pro · API',
        description:                'AIFISHER Agent 中转线路 Seedream 5.0 Pro，含图层拆分',
        timeEstimate:               '3min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Seedream v5 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "1:2", "2:1", "1:4", "4:1", "1:8", "8:1", "21:9"],
        cost:                       { "1K": 0.311, "2K": 0.621 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } },
            { label: '图层拆分', value: 'layer-decomposition', allowedInputs: { 'text': 10, 'image': 1 } }
        ],
        endpoint: {
            'text-to-image':       { url: 'https://api.work-fisher.com/v1/image/generations', model: 'seedream-v5-pro-t2i' },
            'image-to-image':      { url: 'https://api.work-fisher.com/v1/image/generations', model: 'seedream-v5-pro-i2i' },
            'layer-decomposition': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'seedream-v5-pro-layer-decomposition' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Seedream 5.0 Pro · API宽审核',
        variantLabel:               '宽审核',
        description:                'AIFISHER API海外线路，审核更宽松，按美元结算',
        timeEstimate:               '3min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Seedream v5 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "1:2", "2:1", "1:4", "4:1", "1:8", "8:1", "21:9"],
        cost:                       { "1K": 0.374768, "2K": 2.836 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } },
            { label: '图层拆分', value: 'layer-decomposition', allowedInputs: { 'text': 10, 'image': 1 } }
        ],
        endpoint: {
            'text-to-image':       { url: 'https://api.work-fisher.com/v1/image/generations', model: 'dola-seedream-5.0-pro-t2i' },
            'image-to-image':      { url: 'https://api.work-fisher.com/v1/image/generations', model: 'dola-seedream-5.0-pro-i2i' },
            'layer-decomposition': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'dola-seedream-5.0-pro-layer-decomposition' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Midjourney Imagine · API',
        description:                'AIFISHER Agent 中转线路 Midjourney Imagine；支持普通、角色、风格与深度参考图，按实际上游任务消耗结算。',
        timeEstimate:               '15min',
        provider:                   'RelayMidjourneyProvider',
        source:                     'relay',
        canonicalModel:             'Midjourney Imagine',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  14,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ['1K'],
        aspectRatios:               ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'],
        cost:                       { '1K': 0.57792 },
        priceNoteByMode: {
            'text-to-image': '默认 Fast 历史估价约 ¥0.5779/任务；每个 Imagine 任务固定返回 4 张候选，结果数量只控制画布保留几张；Relax/Turbo 按当前速度动态核价'
        },
        imageModes: [
            { label: 'Imagine', value: 'text-to-image', allowedInputs: { 'text': 1, 'image': 13 } }
        ],
        endpoint: {
            'text-to-image': { url: 'https://api.work-fisher.com/v1/midjourney/generations', model: 'midjourney-imagine' }
        },
        advancedParams: [
            { key: 'generateCount', label: '保留结果数', type: 'slider', default: 1, min: 1, max: 4 },
            {
                key: 'version', label: '模型版本', type: 'select', default: '8.2', options: [
                    { label: 'V8.2', value: '8.2' },
                    { label: 'V8.1', value: '8.1' },
                    { label: 'V7', value: '7' },
                    { label: 'V6.1', value: '6.1' },
                    { label: 'V5.2', value: '5.2' },
                    { label: 'V5.1', value: '5.1' }
                ]
            },
            {
                key: 'speed', label: '生成速度', type: 'select', default: 'fast', options: [
                    { label: 'Relax', value: 'relax' },
                    { label: 'Fast', value: 'fast' },
                    { label: 'Turbo', value: 'turbo' }
                ]
            },
            {
                key: 'quality', label: '质量', type: 'select', default: '1', options: [
                    { label: '0.25', value: '0.25' },
                    { label: '0.5', value: '0.5' },
                    { label: '1', value: '1' },
                    { label: '2', value: '2' }
                ]
            },
            { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 4294967295 },
            { key: 'stylize', label: '风格化', type: 'number', min: 0, max: 1000 },
            { key: 'chaos', label: '变化强度', type: 'number', min: 0, max: 100 },
            { key: 'weird', label: '怪异程度', type: 'number', min: 0, max: 3000 },
            { key: 'iw', label: '普通参考权重', type: 'number', min: 0, max: 3, step: 0.1 },
            { key: 'cw', label: '角色参考权重', type: 'number', min: 0, max: 100, step: 1 },
            { key: 'sw', label: '风格参考权重', type: 'number', min: 0, max: 1000, step: 1 },
            { key: 'dw', label: '深度参考权重', type: 'number', min: 0, max: 100, step: 1 },
            { key: 'negative_prompt', label: '负面提示词', type: 'text' },
            { key: 'tile', label: '无缝平铺', type: 'toggle', default: false },
            { key: 'niji', label: 'Niji 模式', type: 'toggle', default: false },
            { key: 'raw', label: 'Raw 模式', type: 'toggle', default: true },
            { key: 'draft', label: 'Draft 模式', type: 'toggle', default: false },
            { key: 'hd', label: 'HD 模式', type: 'toggle', default: true }
        ]
    },
    {
        name:                       'Qwen Image 3.0 · API',
        description:                'AIFISHER API通义千问图像 3.0',
        timeEstimate:               '2min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Qwen Image 3.0',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  3,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.216, "2K": 0.216 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图像编辑', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 3 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'qwen-image-3.0-t2i' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'qwen-image-3.0-i2i' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Qwen Image 3.0 Pro · API',
        description:                'AIFISHER API通义千问图像 3.0 Pro',
        timeEstimate:               '2min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Qwen Image 3.0 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  3,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.310, "2K": 0.607 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图像编辑', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 3 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'qwen-image-3.0-pro-t2i' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'qwen-image-3.0-pro-i2i' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Qwen Image 3.0 · API宽审核',
        variantLabel:               '宽审核',
        description:                'AIFISHER API海外线路，审核更宽松',
        timeEstimate:               '2min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Qwen Image 3.0',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  3,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.255, "2K": 0.255 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图像编辑', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 3 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'qwen-image-3.0-global-t2i' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'qwen-image-3.0-global-i2i' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },
    {
        name:                       'Qwen Image 3.0 Pro · API宽审核',
        variantLabel:               '宽审核',
        description:                'AIFISHER API海外线路，审核更宽松',
        timeEstimate:               '2min',
        provider:                   'RelayImageProvider',
        source:                     'relay',
        canonicalModel:             'Qwen Image 3.0 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  3,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.340, "2K": 0.642 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图像编辑', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 3 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://api.work-fisher.com/v1/image/generations', model: 'qwen-image-3.0-global-pro-t2i' },
            'image-to-image': { url: 'https://api.work-fisher.com/v1/image/generations', model: 'qwen-image-3.0-global-pro-i2i' }
        },
        advancedParams: [
            { key: 'generateCount', label: '批量生成数量', type: 'number', default: 1, min: 1, step: 1 }
        ]
    },

    /* ========================================================================
     * RH AI 站（www.runninghub.ai）
     *
     * 2026-08-12 实测：RunningHub 已把整个「全能图片」标准模型系列从 CN 站下线，
     * CN 站每个该系列模型的详情页都渲染「该模型在当前 CN 站已下线，请前往
     * RunningHub 全球站继续使用」（对照组：可灵系列没有这条横幅，说明是条件渲染）。
     * 迁站只换域名：openapi/v2 前缀与 slug 都没动，全球站显示的
     * nano-banana-2 image-to-image economy 只是展示名，接口仍是 rhart-image-n-g31-flash。
     *
     * 两站账号不互通（各自注册、充值、API Key），所以走独立的
     * RunningHubGlobalImageProvider + RUNNINGHUB_GLOBAL_API_KEY。
     *
     * 价格：直接采用 RH AI 站当前价格表已经换算并展示的人民币数字，不再自行按美元汇率折算。
     *
     * 条目内部一律不写 // 注释：构建期注入脚本会压掉换行，行尾注释会吃掉后面所有代码。
     * ======================================================================== */
    {
        name:                       'GPT Image 2 · RH AI站',
        description:                'RH AI 站 gpt-image-2 官方稳定版；采用当前画布 medium 画质档人民币价格',
        timeEstimate:               '5min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'GPT Image 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.38, "2K": 0.76, "4K": 1.13 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-g-2-official/text-to-image', model: 'rhart-image-g-2-official' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-g-2-official/image-to-image', model: 'rhart-image-g-2-official' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'GPT Image 2 · RH AI站低价',
        premium:                    true,
        tier:                       'budget',
        description:                'RH AI 站低价渠道，当前画布人民币一口价；分辨率不可控，介意请用官方稳定版',
        timeEstimate:               '5min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'GPT Image 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       0.10,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-g-2/text-to-image', model: 'rhart-image-g-2' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-g-2/image-to-image', model: 'rhart-image-g-2' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Nano Banana Pro · RH AI站',
        description:                'RH AI 站 nano-banana-pro 官方稳定版；采用当前画布人民币价格',
        timeEstimate:               '5min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Nano Banana Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { "1K": 0.80, "2K": 1.00, "4K": 1.50 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-pro-official/text-to-image', model: 'rhart-image-n-pro-official' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-pro-official/edit', model: 'rhart-image-n-pro-official' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Nano Banana Pro · RH AI站低价',
        premium:                    true,
        tier:                       'budget',
        description:                'RH AI 站低价渠道；采用当前画布人民币价格，稳定性不保证',
        timeEstimate:               '5min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Nano Banana Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { "1K": 0.40, "2K": 0.40, "4K": 0.50 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-pro/text-to-image', model: 'rhart-image-n-pro' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-pro/edit', model: 'rhart-image-n-pro' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Nano Banana 2 · RH AI站',
        description:                'RH AI 站 nano-banana-2 官方稳定版；采用当前画布人民币价格',
        timeEstimate:               '5min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Nano Banana 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  14,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { "1K": 0.49, "2K": 0.74, "4K": 0.99 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 14 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 14, 'image': 14 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash-official/text-to-image', model: 'rhart-image-n-g31-flash-official' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash-official/image-to-image', model: 'rhart-image-n-g31-flash-official' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Nano Banana 2 · RH AI站低价',
        premium:                    true,
        tier:                       'budget',
        description:                'RH AI 站低价渠道；采用当前画布人民币价格，稳定性不保证',
        timeEstimate:               '5min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Nano Banana 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  14,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { "1K": 0.19, "2K": 0.19, "4K": 0.30 },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 14 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 14, 'image': 14 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash/text-to-image', model: 'rhart-image-n-g31-flash' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash/image-to-image', model: 'rhart-image-n-g31-flash' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Nano Banana 1 · RH AI站',
        description:                'RH AI 站初代 nano-banana 官方稳定版；采用当前画布人民币一口价',
        timeEstimate:               '3min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Nano Banana 1',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       0.20,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-v1-official/text-to-image', model: 'rhart-image-v1-official' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-v1-official/edit', model: 'rhart-image-v1-official' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Nano Banana 1 · RH AI站低价',
        premium:                    true,
        tier:                       'budget',
        description:                'RH AI 站低价渠道，折算自 $0.01 一口价；稳定性不保证',
        timeEstimate:               '3min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Nano Banana 1',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       0.07,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-v1/text-to-image', model: 'rhart-image-v1' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-v1/edit', model: 'rhart-image-v1' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Nano Banana 2 Lite · RH AI站',
        description:                'RH AI 站 nano-banana-2-lite 官方稳定版；采用当前画布人民币一口价',
        timeEstimate:               '3min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Nano Banana 2 Lite',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       0.22,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash-lite/text-to-image', model: 'rhart-image-n-g31-flash-lite' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash-lite/image-to-image', model: 'rhart-image-n-g31-flash-lite' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Nano Banana 2 Lite · RH AI站低价',
        premium:                    true,
        tier:                       'budget',
        description:                'RH AI 站低价渠道，折算自 $0.01 一口价；稳定性不保证',
        timeEstimate:               '3min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Nano Banana 2 Lite',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       0.07,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash-lite/text-to-image', model: 'rhart-image-n-g31-flash-lite' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash-lite/image-to-image', model: 'rhart-image-n-g31-flash-lite' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Grok 2 · RH AI站',
        brand:                      'Grok 2',
        description:                'RH AI 站 grok-imagine-image 官方稳定版；采用当前画布人民币一口价',
        timeEstimate:               '3min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Grok 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  1,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       0.14,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 1 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 1, 'image': 1 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-x-official/text-to-image', model: 'rhart-image-x-official' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-x-official/edit', model: 'rhart-image-x-official' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Grok 2 · RH AI站低价',
        brand:                      'Grok 2',
        premium:                    true,
        tier:                       'budget',
        description:                'RH AI 站低价渠道；采用当前画布人民币一口价，稳定性不保证',
        timeEstimate:               '3min',
        provider:                   'RunningHubGlobalImageProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Grok 2',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  1,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       0.08,
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 1 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 1, 'image': 1 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-g/text-to-image', model: 'rhart-image-g' },
            'image-to-image': { url: 'https://www.runninghub.ai/openapi/v2/rhart-image-g/image-to-image', model: 'rhart-image-g' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },

    /* ========================================================================
     * RH CN 站（www.runninghub.cn）标准模型
     *
     * 迁走的只有「全能图片」那一族。Seedream、千问、即梦、悠船、Z-Image 等分类
     * 2026-08-12 实测全部仍在 CN 站在线（详情页没有迁移横幅）。
     * 这里只补与 AIFISHER API同名同版本、能直接比价的三个。
     *
     * 价格直接抄 CN 站价格页的人民币牌价，不折算。
     * 接口路径取自各模型详情页的「接口:」字段，前缀 openapi/v2 与全球站一致。
     * 条目内部一律不写 // 注释：注入脚本会压掉换行，行尾注释会吃掉后面所有代码。
     * ======================================================================== */
    {
        name:                       'Seedream v5 Pro · RH CN站',
        description:                'RH CN 站 seedream-v5-pro，牌价 236 万像素以内每张 0.27 元、超出 0.54 元；图生图另计输入图 0.018 元一张，首张免费',
        timeEstimate:               '3min',
        provider:                   'RunningHubImageProvider',
        source:                     'runninghub',
        canonicalModel:             'Seedream v5 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K", "4K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.27, "2K": 0.54, "4K": 0.54 },
        rhPriceRules: {
            'total|text-to-image|1k|*|*|*': 0.27,
            'total|text-to-image|2k|*|*|*': 0.54,
            'total|text-to-image|4k|*|*|*': 0.54,
            'total|image-to-image|1k|*|*|*': 0.27,
            'total|image-to-image|2k|*|*|*': 0.54,
            'total|image-to-image|4k|*|*|*': 0.54,
            'image-surcharge|image-to-image|*|1|*|1+': 0.018
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.cn/openapi/v2/seedream-v5-pro/text-to-image', model: 'seedream-v5-pro' },
            'image-to-image': { url: 'https://www.runninghub.cn/openapi/v2/seedream-v5-pro/image-to-image', model: 'seedream-v5-pro' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Qwen Image 3.0 · RH CN站',
        description:                'RH CN 站千问 3.0，牌价每张 0.16 元；图像编辑另计输入图 0.02 元一张',
        timeEstimate:               '3min',
        provider:                   'RunningHubImageProvider',
        source:                     'runninghub',
        canonicalModel:             'Qwen Image 3.0',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.16, "2K": 0.16 },
        rhPriceRules: {
            'total|text-to-image|1k|*|*|*': 0.16,
            'total|text-to-image|2k|*|*|*': 0.16,
            'total|image-to-image|1k|*|*|*': 0.16,
            'total|image-to-image|2k|*|*|*': 0.16,
            'image-surcharge|image-to-image|*|0|*|1+': 0.02
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.cn/openapi/v2/alibaba/qwen-image-3.0/text-to-image', model: 'alibaba/qwen-image-3.0' },
            'image-to-image': { url: 'https://www.runninghub.cn/openapi/v2/alibaba/qwen-image-3.0/image-edit', model: 'alibaba/qwen-image-3.0' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       'Qwen Image 3.0 Pro · RH CN站',
        description:                'RH CN 站千问 3.0 Pro，牌价 1K 每张 0.23 元、2K 0.45 元；图像编辑另计输入图 0.02 元一张',
        timeEstimate:               '3min',
        provider:                   'RunningHubImageProvider',
        source:                     'runninghub',
        canonicalModel:             'Qwen Image 3.0 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        supportedImageFormats:      ['jpeg', 'png', 'webp'],
        maxImageSizeMb:             20,
        resolutions:                ["1K", "2K"],
        aspectRatios:               ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { "1K": 0.23, "2K": 0.45 },
        rhPriceRules: {
            'total|text-to-image|1k|*|*|*': 0.23,
            'total|text-to-image|2k|*|*|*': 0.45,
            'total|image-to-image|1k|*|*|*': 0.23,
            'total|image-to-image|2k|*|*|*': 0.45,
            'image-surcharge|image-to-image|*|0|*|1+': 0.02
        },
        imageModes: [
            { label: '文生图', value: 'text-to-image', allowedInputs: { 'text': 10 } },
            { label: '图生图', value: 'image-to-image', allowedInputs: { 'text': 10, 'image': 10 } }
        ],
        endpoint: {
            'text-to-image':  { url: 'https://www.runninghub.cn/openapi/v2/alibaba/qwen-image-3.0-pro/text-to-image', model: 'alibaba/qwen-image-3.0-pro' },
            'image-to-image': { url: 'https://www.runninghub.cn/openapi/v2/alibaba/qwen-image-3.0-pro/image-edit', model: 'alibaba/qwen-image-3.0-pro' }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name: 'SeedVR2 高清放大 · RH',
        description: '图片工具栏专用；按 RH 云端应用公开字段接入，使用应用默认放大设置。费用以 RunningHub 账单为准。',
        provider: 'SeedVr2ImageProvider', source: 'runninghub', canonicalModel: 'SeedVR2',
        timeEstimate: '20min', maxConcurrent: 1, useProxy: false, maxInputs: 1,
        supportedReferenceTypes: ['image'], supportedImageFormats: ['png', 'jpeg', 'webp'],
        maxImageSizeMb: 30, resolutions: ['Auto'], aspectRatios: ['Auto'], cost: undefined,
        imageModes: [{ label: '高清放大', value: 'image-to-image', allowedInputs: { image: 1 } }],
        endpoint: { 'image-to-image': { url: 'https://www.runninghub.cn/task/openapi/ai-app/run', model: '2097920992202022914' } },
        advancedParams: [],
    },
];

/**
 * 音频模型配置
 */
export const AUDIO_MODELS = [
    {
        name:                       'Mureka 音乐',
        description:                '支持音乐与音效生成',
        timeEstimate:               '5min',
        provider:                   'MurekaAudioProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'audio'],
        supportedAudioFormats:      ['mp3', 'm4a'],
        maxAudioDurationSec:        30,
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0.2,
        audioModes: [
            { label: '歌词音乐', value: 'lyrics-to-music', allowedInputs: { 'text': 10 } },
            { label: '背景音乐', value: 'instrumental', allowedInputs: { 'text': 10 } }
        ],
        endpoint: {
            'lyrics-to-music': {
                url: 'https://api.mureka.cn/v1/song/generate',
                model: 'auto'
            },
            'instrumental': {
                url: 'https://api.mureka.cn/v1/instrumental/generate',
                model: 'auto'
            }
        },
        advancedParams: [
            { key: 'generateCount', label: '生成数量', type: 'slider', default: 1, min: 1, max: 1 }
        ]
    },
    {
        name:                       '豆包 Seed Audio 1.0 · API',
        description:                'AIFISHER Agent 中转线路；支持文本、参考音频或参考图生成音频，按实际输出计费。',
        timeEstimate:               '10min',
        provider:                   'RelayAudioProvider',
        source:                     'relay',
        canonicalModel:             '豆包 Seed Audio 1.0',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  5,
        supportedReferenceTypes:    ['text', 'image', 'audio'],
        supportedAudioFormats:      ['mp3', 'wav', 'ogg'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0.05394,
        audioModes: [
            { label: '生成音频', value: 'generate-audio', allowedInputs: { 'text': 1, 'image': 1, 'audio': 3 } }
        ],
        endpoint: {
            'generate-audio': { url: 'https://api.work-fisher.com/v1/audio/generations', model: 'doubao-seed-audio-1.0' }
        },
        advancedParams: [
            {
                key: 'format', label: '输出格式', type: 'select', default: 'mp3', options: [
                    { label: 'MP3', value: 'mp3' },
                    { label: 'WAV', value: 'wav' },
                    { label: 'PCM', value: 'pcm' },
                    { label: 'OGG Opus', value: 'ogg_opus' }
                ]
            },
            {
                key: 'sample_rate', label: '采样率', type: 'select', default: '24000', options: [
                    { label: '8 kHz', value: '8000' },
                    { label: '16 kHz', value: '16000' },
                    { label: '24 kHz', value: '24000' },
                    { label: '32 kHz', value: '32000' },
                    { label: '44.1 kHz', value: '44100' }
                ]
            },
            { key: 'speaker', label: '音色 ID', type: 'text' },
            { key: 'speech_rate', label: '语速', type: 'slider', default: 0, min: -50, max: 100 },
            { key: 'loudness_rate', label: '音量', type: 'slider', default: 0, min: -50, max: 100 },
            { key: 'pitch_rate', label: '音高', type: 'slider', default: 0, min: -12, max: 12 }
        ]
    },
    {
        name:                       'MiniMax Voice Clone · API',
        description:                'AIFISHER Agent 中转线路；使用一段参考音频克隆音色并合成输入文本。',
        timeEstimate:               '10min',
        provider:                   'RelayAudioProvider',
        source:                     'relay',
        canonicalModel:             'MiniMax Voice Clone',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  2,
        supportedReferenceTypes:    ['text', 'audio'],
        supportedAudioFormats:      ['mp3', 'wav', 'm4a'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       4.16,
        audioModes: [
            { label: '声音克隆', value: 'voice-clone', allowedInputs: { 'text': 1, 'audio': 1 } }
        ],
        endpoint: {
            'voice-clone': { url: 'https://api.work-fisher.com/v1/audio/generations', model: 'minimax-voice-clone' }
        },
        advancedParams: [
            { key: 'custom_voice_id', label: '自定义音色 ID', type: 'text' },
            { key: 'accuracy', label: '克隆精度', type: 'slider', default: 0.8, min: 0, max: 1, step: 0.05 },
            { key: 'need_noise_reduction', label: '参考音降噪', type: 'toggle', default: false },
            { key: 'need_volume_normalization', label: '音量标准化', type: 'toggle', default: false },
            {
                key: 'tts_model', label: '合成模型', type: 'select', default: 'speech-2.8-hd', options: [
                    { label: 'Speech 2.8 HD', value: 'speech-2.8-hd' },
                    { label: 'Speech 2.8 Turbo', value: 'speech-2.8-turbo' },
                    { label: 'Speech 2.6 HD', value: 'speech-2.6-hd' },
                    { label: 'Speech 2.6 Turbo', value: 'speech-2.6-turbo' }
                ]
            },
            { key: 'language_boost', label: '语言增强', type: 'text' }
        ]
    },
    {
        name:                       'Qwen3 TTS Flash · API',
        description:                'AIFISHER Agent 中转线路 Qwen3 TTS Flash，按输出音频时长动态计费。',
        timeEstimate:               '10min',
        provider:                   'RelayAudioProvider',
        source:                     'relay',
        canonicalModel:             'Qwen3 TTS Flash',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  1,
        supportedReferenceTypes:    ['text'],
        supportedAudioFormats:      ['mp3', 'wav'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0.004,
        audioModes: [
            { label: '文字转语音', value: 'text-to-speech', allowedInputs: { 'text': 1 } }
        ],
        endpoint: {
            'text-to-speech': { url: 'https://api.work-fisher.com/v1/audio/generations', model: 'qwen3-tts-flash' }
        },
        advancedParams: [
            {
                key: 'voice', label: '音色', type: 'select', default: 'Cherry', options: [
                    { label: 'Cherry', value: 'Cherry' },
                    { label: 'Serena', value: 'Serena' },
                    { label: 'Ethan', value: 'Ethan' },
                    { label: 'Chelsie', value: 'Chelsie' },
                    { label: 'Momo', value: 'Momo' },
                    { label: 'Vivian', value: 'Vivian' },
                    { label: 'Moon', value: 'Moon' },
                    { label: 'Maia', value: 'Maia' },
                    { label: 'Kai', value: 'Kai' },
                    { label: 'Nofish', value: 'Nofish' }
                ]
            },
            {
                key: 'language_type', label: '语言', type: 'select', default: 'Auto', options: [
                    { label: '自动', value: 'Auto' },
                    { label: '中文', value: 'Chinese' },
                    { label: '英语', value: 'English' },
                    { label: '日语', value: 'Japanese' },
                    { label: '韩语', value: 'Korean' },
                    { label: '法语', value: 'French' },
                    { label: '德语', value: 'German' },
                    { label: '西班牙语', value: 'Spanish' }
                ]
            }
        ]
    },
    {
        name:                       'Suno Generation · API',
        description:                'AIFISHER Agent 中转线路 Suno；一次通常返回两条音乐，按实际上游消耗结算。',
        timeEstimate:               '15min',
        provider:                   'RelayMusicProvider',
        source:                     'relay',
        canonicalModel:             'Suno Generation',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  1,
        supportedReferenceTypes:    ['text'],
        supportedAudioFormats:      ['mp3'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       0.54545,
        audioModes: [
            { label: '音乐生成', value: 'music-generation', allowedInputs: { 'text': 1 } }
        ],
        endpoint: {
            'music-generation': { url: 'https://api.work-fisher.com/v1/music/generations', model: 'suno-generation' }
        },
        advancedParams: [
            {
                key: 'version', label: 'Suno 版本', type: 'select', default: 'v5', options: [
                    { label: 'V5.5', value: 'v5.5' },
                    { label: 'V5', value: 'v5' },
                    { label: 'V4.5+', value: 'v4.5+' },
                    { label: 'V4.5', value: 'v4.5' },
                    { label: 'V4', value: 'v4' },
                    { label: 'V3.5', value: 'v3.5' }
                ]
            },
            { key: 'custom', label: '自定义歌词', type: 'toggle', default: false },
            { key: 'instrumental', label: '纯伴奏', type: 'toggle', default: false },
            { key: 'title', label: '曲名', type: 'text' },
            { key: 'style', label: '风格', type: 'text' },
            {
                key: 'vocal_gender', label: '人声偏好', type: 'select', default: '', options: [
                    { label: '不指定', value: '' },
                    { label: '男声', value: 'Male' },
                    { label: '女声', value: 'Female' }
                ]
            }
        ]
    },
    {
        name:                       'Suno Stems · API',
        description:                'AIFISHER Agent 中转线路 Suno 分轨；输入原始 Suno task_id 与轨道序号。',
        timeEstimate:               '15min',
        provider:                   'RelayMusicProvider',
        source:                     'relay',
        canonicalModel:             'Suno Stems',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  1,
        supportedReferenceTypes:    ['text'],
        supportedAudioFormats:      ['mp3'],
        resolutions:                [],
        aspectRatios:               [],
        cost:                       1.09091,
        audioModes: [
            { label: '音轨分离', value: 'stems', allowedInputs: { 'text': 1 } }
        ],
        endpoint: {
            'stems': { url: 'https://api.work-fisher.com/v1/music/generations/stems', model: 'suno-stems' }
        },
        advancedParams: [
            { key: 'task_id', label: '原始 Suno task_id', type: 'text' },
            { key: 'audio_index', label: '轨道序号', type: 'slider', default: 1, min: 1, max: 100 }
        ]
    }
];

/**
 * 视频模型配置
 */
export const VIDEO_MODELS = [
    {
        name: 'Seedance 2.5 · LibTV CLI', brand: 'Seedance',
        description: '通过 LibTV CLI 生成视频，支持首帧、首尾帧和图像/视频/音频参考，按 LibTV 积分账单扣费。',
        timeEstimate: '30min', provider: 'LibTvCliVideoProvider', source: 'libtv_cli',
        canonicalModel: 'Seedance 2.5', maxConcurrent: 1, useProxy: false,
        maxInputs: 50, supportedReferenceTypes: ['text', 'image', 'video', 'audio'],
        resolutions: ['480p', '720p', '1080p'], aspectRatios: ['1:1','3:4','16:9','4:3','9:16','21:9'], cost: 0,
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { text: 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { text: 10, image: 1 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { text: 10, image: 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { text: 10, image: 30, video: 10, audio: 10 } }
        ],
        endpoint: {
            'text-to-video': { url: 'local:libtv-cli', model: 'Seedance 2.5' },
            'first-frame': { url: 'local:libtv-cli', model: 'Seedance 2.5' },
            'i2v-first-last-frame': { url: 'local:libtv-cli', model: 'Seedance 2.5' },
            multimodal: { url: 'local:libtv-cli', model: 'Seedance 2.5' }
        },
        advancedParams: [{ key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 30, unit: 's' }]
    },
    {
        name:                       'Seedance 2.5 · 即梦 CLI',
        brand:                      'Seedance',
        description:                '即梦 CLI 的 Seedance 2.5（仅限具备权限的即梦账号）；按即梦积分账单扣费。',
        timeEstimate:               '30min',
        provider:                   'DreaminaCliVideoProvider',
        source:                     'dreamina_cli',
        canonicalModel:             'Seedance 2.5',
        maxConcurrent:              1,
        useProxy:                   false,
        maxInputs:                  50,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p'],
        aspectRatios:               ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'],
        cost:                       0,
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 1 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 30, 'video': 10, 'audio': 10 } }
        ],
        endpoint: {
            'text-to-video': { url: 'local:dreamina-cli', model: 'seedance2.5' },
            'first-frame': { url: 'local:dreamina-cli', model: 'seedance2.5' },
            'i2v-first-last-frame': { url: 'local:dreamina-cli', model: 'seedance2.5' },
            'multimodal': { url: 'local:dreamina-cli', model: 'seedance2.5' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 30, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Fast · 即梦 CLI',
        brand:                      'Seedance',
        description:                '即梦 CLI 的 Seedance 2.0 Fast；当前公开命令只支持 720p，按即梦积分账单扣费。',
        timeEstimate:               '15min',
        provider:                   'DreaminaCliVideoProvider',
        source:                     'dreamina_cli',
        canonicalModel:             'Seedance 2.0 Fast',
        maxConcurrent:              1,
        useProxy:                   false,
        maxInputs:                  12,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p'],
        aspectRatios:               ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'],
        cost:                       0,
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 1 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', requiresVisualReference: true, allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'local:dreamina-cli', model: 'seedance2.0fast' },
            'first-frame': { url: 'local:dreamina-cli', model: 'seedance2.0fast' },
            'i2v-first-last-frame': { url: 'local:dreamina-cli', model: 'seedance2.0fast' },
            'multimodal': { url: 'local:dreamina-cli', model: 'seedance2.0fast' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Mini · 即梦 CLI',
        brand:                      'Seedance',
        description:                '即梦 CLI 的 Seedance 2.0 Mini；当前公开命令只支持 720p，按即梦积分账单扣费。',
        timeEstimate:               '15min',
        provider:                   'DreaminaCliVideoProvider',
        source:                     'dreamina_cli',
        canonicalModel:             'Seedance 2.0 Mini',
        maxConcurrent:              1,
        useProxy:                   false,
        maxInputs:                  12,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p'],
        aspectRatios:               ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'],
        cost:                       0,
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 1 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', requiresVisualReference: true, allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'local:dreamina-cli', model: 'seedance2.0mini' },
            'first-frame': { url: 'local:dreamina-cli', model: 'seedance2.0mini' },
            'i2v-first-last-frame': { url: 'local:dreamina-cli', model: 'seedance2.0mini' },
            'multimodal': { url: 'local:dreamina-cli', model: 'seedance2.0mini' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 · 即梦 CLI',
        brand:                      'Seedance',
        description:                '即梦 CLI 的 Seedance 2.0；当前公开命令只支持 720p，按即梦积分账单扣费。',
        timeEstimate:               '15min',
        provider:                   'DreaminaCliVideoProvider',
        source:                     'dreamina_cli',
        canonicalModel:             'Seedance 2.0',
        maxConcurrent:              1,
        useProxy:                   false,
        maxInputs:                  12,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p'],
        aspectRatios:               ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'],
        cost:                       0,
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 1 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', requiresVisualReference: true, allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'local:dreamina-cli', model: 'seedance2.0' },
            'first-frame': { url: 'local:dreamina-cli', model: 'seedance2.0' },
            'i2v-first-last-frame': { url: 'local:dreamina-cli', model: 'seedance2.0' },
            'multimodal': { url: 'local:dreamina-cli', model: 'seedance2.0' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.5 · RH CN站',
        brand:                      'Seedance',
        description:                'RH CN站 Seedance 2.5。按 completion tokens 动态计费；来源比价会按当前比例、分辨率与时长换算为任务估价。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Seedance 2.5',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        priceFormula:               'seedance-output-tokens',
        tokenPricePerMillion:       87.5,
        tokenVideoPricePerMillion:  52.5,
        resolutionSurcharge:        { '1080p': 0.32, '2k': 0.42, '4k': 0.63 },
        priceTextByMode: {
            'text-to-video': {
                'default': '¥87.5/百万 tokens',
                '480p': '¥87.5/百万 tokens',
                '720p': '¥87.5/百万 tokens',
                '1080p': '¥87.5/百万 tokens + ¥0.32/秒',
                '2k': '¥87.5/百万 tokens + ¥0.42/秒',
                '4k': '¥87.5/百万 tokens + ¥0.63/秒'
            },
            'first-frame': {
                'default': '¥87.5/百万 tokens',
                '480p': '¥87.5/百万 tokens',
                '720p': '¥87.5/百万 tokens',
                '1080p': '¥87.5/百万 tokens + ¥0.32/秒',
                '2k': '¥87.5/百万 tokens + ¥0.42/秒',
                '4k': '¥87.5/百万 tokens + ¥0.63/秒'
            },
            'multimodal': {
                'default': '¥52.5–87.5/百万 tokens',
                '480p': '¥52.5–87.5/百万 tokens',
                '720p': '¥52.5–87.5/百万 tokens',
                '1080p': '¥52.5–87.5/百万 tokens + ¥0.32/秒',
                '2k': '¥52.5–87.5/百万 tokens + ¥0.42/秒',
                '4k': '¥52.5–87.5/百万 tokens + ¥0.63/秒'
            }
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/bytedance/seedance-2.5-token/text-to-video', model: 'seedance-2.5-token' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/bytedance/seedance-2.5-token/image-to-video', model: 'seedance-2.5-token' },
            'multimodal': { url: 'https://www.runninghub.cn/openapi/v2/bytedance/seedance-2.5-token/multimodal-video', model: 'seedance-2.5-token' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 30, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 · RH CN站',
        brand:                      'Seedance',
        description:                'RH CN站 Seedance 2.0 当前画布价；无参考按生成秒计费，有参考按 RH 时长档计费。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Seedance 2.0',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.6, '720p': 1.2, '1080p': 1.48, '2k': 1.62, '4k': 1.83 },
        rhPriceRules: {
            'rate|text-to-video|480p|*|*|*': 0.6,
            'rate|text-to-video|720p|*|*|*': 1.2,
            'rate|text-to-video|1080p|*|*|*': 1.48,
            'rate|text-to-video|2k|*|*|*': 1.62,
            'rate|text-to-video|4k|*|*|*': 1.83,
            'rate|first-frame|480p|*|*|*': 0.6,
            'rate|first-frame|720p|*|*|*': 1.2,
            'rate|first-frame|1080p|*|*|*': 1.48,
            'rate|first-frame|2k|*|*|*': 1.62,
            'rate|first-frame|4k|*|*|*': 1.83,
            'rate|multimodal|480p|*|*|0': 0.6,
            'rate|multimodal|720p|*|*|0': 1.2,
            'rate|multimodal|1080p|*|*|0': 1.48,
            'rate|multimodal|2k|*|*|0': 1.62,
            'rate|multimodal|4k|*|*|0': 1.83,
            'floor-rate|multimodal|480p|*|*|1+': 0.4,
            'floor-rate|multimodal|720p|*|*|1+': 0.8,
            'floor-rate|multimodal|1080p|*|*|1+': 0.8,
            'floor-rate|multimodal|2k|*|*|1+': 0.8,
            'floor-rate|multimodal|4k|*|*|1+': 0.8,
            'floor-duration|multimodal|*|4|*|1+': 7,
            'floor-duration|multimodal|*|5|*|1+': 9,
            'floor-duration|multimodal|*|6|*|1+': 10,
            'floor-duration|multimodal|*|7|*|1+': 12,
            'floor-duration|multimodal|*|8|*|1+': 14,
            'floor-duration|multimodal|*|9|*|1+': 15,
            'floor-duration|multimodal|*|10|*|1+': 17,
            'floor-duration|multimodal|*|11|*|1+': 19,
            'floor-duration|multimodal|*|12|*|1+': 20,
            'floor-duration|multimodal|*|13|*|1+': 22,
            'floor-duration|multimodal|*|14|*|1+': 24,
            'floor-duration|multimodal|*|15|*|1+': 25,
            'surcharge-rate|multimodal|1080p|*|*|1+': 0.28,
            'surcharge-rate|multimodal|2k|*|*|1+': 0.42,
            'surcharge-rate|multimodal|4k|*|*|1+': 0.63
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0/text-to-video', model: 'sparkvideo-2.0' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0/image-to-video', model: 'sparkvideo-2.0' },
            'multimodal': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0/multimodal-video', model: 'sparkvideo-2.0' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Fast · RH CN站',
        brand:                      'Seedance',
        description:                'RH CN站 Seedance 2.0 Fast 当前画布价；无参考按生成秒计费，有参考按 RH 时长档计费。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Seedance 2.0 Fast',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.5, '720p': 1.0, '1080p': 1.28, '2k': 1.42, '4k': 1.63 },
        rhPriceRules: {
            'rate|text-to-video|480p|*|*|*': 0.5,
            'rate|text-to-video|720p|*|*|*': 1.0,
            'rate|text-to-video|1080p|*|*|*': 1.28,
            'rate|text-to-video|2k|*|*|*': 1.42,
            'rate|text-to-video|4k|*|*|*': 1.63,
            'rate|first-frame|480p|*|*|*': 0.5,
            'rate|first-frame|720p|*|*|*': 1.0,
            'rate|first-frame|1080p|*|*|*': 1.28,
            'rate|first-frame|2k|*|*|*': 1.42,
            'rate|first-frame|4k|*|*|*': 1.63,
            'rate|multimodal|480p|*|*|0': 0.5,
            'rate|multimodal|720p|*|*|0': 1.0,
            'rate|multimodal|1080p|*|*|0': 1.28,
            'rate|multimodal|2k|*|*|0': 1.42,
            'rate|multimodal|4k|*|*|0': 1.63,
            'floor-rate|multimodal|480p|*|*|1+': 0.3,
            'floor-rate|multimodal|720p|*|*|1+': 0.6,
            'floor-rate|multimodal|1080p|*|*|1+': 0.6,
            'floor-rate|multimodal|2k|*|*|1+': 0.6,
            'floor-rate|multimodal|4k|*|*|1+': 0.6,
            'floor-duration|multimodal|*|4|*|1+': 7,
            'floor-duration|multimodal|*|5|*|1+': 9,
            'floor-duration|multimodal|*|6|*|1+': 10,
            'floor-duration|multimodal|*|7|*|1+': 12,
            'floor-duration|multimodal|*|8|*|1+': 14,
            'floor-duration|multimodal|*|9|*|1+': 15,
            'floor-duration|multimodal|*|10|*|1+': 17,
            'floor-duration|multimodal|*|11|*|1+': 19,
            'floor-duration|multimodal|*|12|*|1+': 20,
            'floor-duration|multimodal|*|13|*|1+': 22,
            'floor-duration|multimodal|*|14|*|1+': 24,
            'floor-duration|multimodal|*|15|*|1+': 25,
            'surcharge-rate|multimodal|1080p|*|*|1+': 0.28,
            'surcharge-rate|multimodal|2k|*|*|1+': 0.42,
            'surcharge-rate|multimodal|4k|*|*|1+': 0.63
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0-fast/text-to-video', model: 'sparkvideo-2.0-fast' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0-fast/image-to-video', model: 'sparkvideo-2.0-fast' },
            'multimodal': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0-fast/multimodal-video', model: 'sparkvideo-2.0-fast' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Mini · RH CN站',
        brand:                      'Seedance',
        description:                'RH CN站 Seedance 2.0 Mini 当前画布价；无参考按生成秒计费，有参考按 RH 时长档计费。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Seedance 2.0 Mini',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.3, '720p': 0.6, '1080p': 0.88, '2k': 1.02, '4k': 1.23 },
        rhPriceRules: {
            'rate|text-to-video|480p|*|*|*': 0.3,
            'rate|text-to-video|720p|*|*|*': 0.6,
            'rate|text-to-video|1080p|*|*|*': 0.88,
            'rate|text-to-video|2k|*|*|*': 1.02,
            'rate|text-to-video|4k|*|*|*': 1.23,
            'rate|first-frame|480p|*|*|*': 0.3,
            'rate|first-frame|720p|*|*|*': 0.6,
            'rate|first-frame|1080p|*|*|*': 0.88,
            'rate|first-frame|2k|*|*|*': 1.02,
            'rate|first-frame|4k|*|*|*': 1.23,
            'rate|multimodal|480p|*|*|0': 0.3,
            'rate|multimodal|720p|*|*|0': 0.6,
            'rate|multimodal|1080p|*|*|0': 0.88,
            'rate|multimodal|2k|*|*|0': 1.02,
            'rate|multimodal|4k|*|*|0': 1.23,
            'floor-rate|multimodal|480p|*|*|1+': 0.2,
            'floor-rate|multimodal|720p|*|*|1+': 0.4,
            'floor-rate|multimodal|1080p|*|*|1+': 0.4,
            'floor-rate|multimodal|2k|*|*|1+': 0.4,
            'floor-rate|multimodal|4k|*|*|1+': 0.4,
            'floor-duration|multimodal|*|4|*|1+': 7,
            'floor-duration|multimodal|*|5|*|1+': 9,
            'floor-duration|multimodal|*|6|*|1+': 10,
            'floor-duration|multimodal|*|7|*|1+': 12,
            'floor-duration|multimodal|*|8|*|1+': 14,
            'floor-duration|multimodal|*|9|*|1+': 15,
            'floor-duration|multimodal|*|10|*|1+': 17,
            'floor-duration|multimodal|*|11|*|1+': 19,
            'floor-duration|multimodal|*|12|*|1+': 20,
            'floor-duration|multimodal|*|13|*|1+': 22,
            'floor-duration|multimodal|*|14|*|1+': 24,
            'floor-duration|multimodal|*|15|*|1+': 25,
            'surcharge-rate|multimodal|1080p|*|*|1+': 0.28,
            'surcharge-rate|multimodal|2k|*|*|1+': 0.42,
            'surcharge-rate|multimodal|4k|*|*|1+': 0.63
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0-mini/text-to-video', model: 'sparkvideo-2.0-mini' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0-mini/image-to-video', model: 'sparkvideo-2.0-mini' },
            'multimodal': { url: 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0-mini/multimodal-video', model: 'sparkvideo-2.0-mini' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling O3 · RH CN站',
        brand:                      'Kling',
        description:                'RH CN站 Kling O3 带声音牌价（¥/秒）。文生/首帧、参考、编辑分别计费。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Kling O3',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.69, '1080p': 0.69 },
        costByMode: {
            'text-to-video': { '720p': 0.69, '1080p': 0.69 },
            'first-frame': { '720p': 0.69, '1080p': 0.69 },
            'reference-video': { '720p': 0.72, '1080p': 0.72 },
            'video-edit': { '720p': 0.81, '1080p': 0.81 }
        },
        rhPriceRules: {
            'rate|text-to-video|*|*|*|*': 0.69,
            'rate|text-to-video|*|*|false|*': 0.52,
            'rate|first-frame|*|*|*|*': 0.69,
            'rate|first-frame|*|*|false|*': 0.52,
            'rate|reference-video|*|*|*|*': 0.72,
            'rate|reference-video|*|*|false|*': 0.54,
            'input-video-rate|video-edit|*|*|*|*': 0.81
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 9 } },
            { label: '视频编辑', value: 'video-edit', allowedInputs: { 'text': 10, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/kling-video-o3-std/text-to-video', model: 'kling-video-o3-std' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/kling-video-o3-std/image-to-video', model: 'kling-video-o3-std' },
            'reference-video': { url: 'https://www.runninghub.cn/openapi/v2/kling-video-o3-std/reference-to-video', model: 'kling-video-o3-std' },
            'video-edit': { url: 'https://www.runninghub.cn/openapi/v2/kling-video-o3-std/video-edit', model: 'kling-video-o3-std' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling O3 Pro · RH CN站',
        brand:                      'Kling',
        description:                'RH CN站 Kling O3 Pro 带声音牌价（¥/秒）。文生/首帧、参考、编辑分别计费。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Kling O3',
        variantLabel:               'Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.87, '1080p': 0.87 },
        costByMode: {
            'text-to-video': { '720p': 0.87, '1080p': 0.87 },
            'first-frame': { '720p': 0.87, '1080p': 0.87 },
            'reference-video': { '720p': 0.90, '1080p': 0.90 },
            'video-edit': { '720p': 1.08, '1080p': 1.08 }
        },
        rhPriceRules: {
            'rate|text-to-video|*|*|*|*': 0.87,
            'rate|text-to-video|*|*|false|*': 0.69,
            'rate|first-frame|*|*|*|*': 0.87,
            'rate|first-frame|*|*|false|*': 0.69,
            'rate|reference-video|*|*|*|*': 0.90,
            'rate|reference-video|*|*|false|*': 0.72,
            'input-video-rate|video-edit|*|*|*|*': 1.08
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 7 } },
            { label: '视频编辑', value: 'video-edit', allowedInputs: { 'text': 10, 'image': 4, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/kling-video-o3-pro/text-to-video', model: 'kling-video-o3-pro' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/kling-video-o3-pro/image-to-video', model: 'kling-video-o3-pro' },
            'reference-video': { url: 'https://www.runninghub.cn/openapi/v2/kling-video-o3-pro/reference-to-video', model: 'kling-video-o3-pro' },
            'video-edit': { url: 'https://www.runninghub.cn/openapi/v2/kling-video-o3-pro/video-edit', model: 'kling-video-o3-pro' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling V3 Turbo · RH CN站',
        brand:                      'Kling',
        description:                'RH CN站 Kling V3 Turbo。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Kling V3 Turbo',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.74, '1080p': 0.74 },
        rhPriceRules: {
            'rate|text-to-video|*|*|*|*': 0.74,
            'rate|first-frame|*|*|*|*': 0.74
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/kling-v3-turbo-std/text-to-video', model: 'kling-v3-turbo-std' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/kling-v3-turbo-std/image-to-video', model: 'kling-v3-turbo-std' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling V3.0 · RH CN站',
        brand:                      'Kling',
        description:                'RH CN站 Kling V3.0。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Kling V3.0',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.78, '1080p': 0.78 },
        rhPriceRules: {
            'rate|text-to-video|*|*|*|*': 0.78,
            'rate|text-to-video|*|*|false|*': 0.52,
            'rate|first-frame|*|*|*|*': 0.78,
            'rate|first-frame|*|*|false|*': 0.52
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/kling-v3.0-std/text-to-video', model: 'kling-v3.0-std' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/kling-v3.0-std/image-to-video', model: 'kling-v3.0-std' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling V3 4K · RH CN站',
        brand:                      'Kling',
        description:                'RH CN站 Kling V3 4K。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Kling V3 4K',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '4k': 2.7 },
        rhPriceRules: {
            'rate|text-to-video|4k|*|*|*': 2.7,
            'rate|first-frame|4k|*|*|*': 2.7
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/kling-v3-4k/text-to-video', model: 'kling-v3-4k' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/kling-v3-4k/image-to-video', model: 'kling-v3-4k' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'MiniMax H3 · RH CN站',
        brand:                      'MiniMax',
        description:                'RH CN站 MiniMax H3 当前画布价；输出视频按分辨率与生成秒计费，多参图片前 5 张免费，超出后每张 ¥0.20。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'MiniMax H3',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['768p', '2k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '768p': 0.38, '2k': 0.62 },
        rhPriceRules: {
            'rate|text-to-video|768p|*|*|*': 0.38,
            'rate|text-to-video|2k|*|*|*': 0.62,
            'rate|first-frame|768p|*|*|*': 0.38,
            'rate|first-frame|2k|*|*|*': 0.62,
            'rate|multimodal|768p|*|*|*': 0.38,
            'rate|multimodal|2k|*|*|*': 0.62,
            'image-surcharge|multimodal|*|5|*|1+': 0.20
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/minimax/hailuo-h3/text-to-video', model: 'hailuo-h3' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/minimax/hailuo-h3/image-to-video', model: 'hailuo-h3' },
            'multimodal': { url: 'https://www.runninghub.cn/openapi/v2/minimax/hailuo-h3/multimodal-to-video', model: 'hailuo-h3' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 5, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Vidu Q3 Pro · RH CN站',
        brand:                      'Vidu',
        description:                'RH CN站 Vidu Q3 Pro。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Vidu Q3 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['540p', '720p', '1080p', '2k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '540p': 0.31, '720p': 0.66, '1080p': 0.70, '2k': 1.09 },
        rhPriceRules: {
            'rate|text-to-video|540p|*|*|*': 0.31,
            'rate|text-to-video|720p|*|*|*': 0.66,
            'rate|text-to-video|1080p|*|*|*': 0.70,
            'rate|first-frame|540p|*|*|*': 0.31,
            'rate|first-frame|720p|*|*|*': 0.66,
            'rate|first-frame|1080p|*|*|*': 0.70,
            'rate|first-frame|2k|*|*|*': 1.09,
            'rate|i2v-first-last-frame|540p|*|*|*': 0.31,
            'rate|i2v-first-last-frame|720p|*|*|*': 0.66,
            'rate|i2v-first-last-frame|1080p|*|*|*': 0.70
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/vidu/text-to-video-q3-pro', model: 'vidu' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/vidu/image-to-video-q3-pro', model: 'vidu' },
            'i2v-first-last-frame': { url: 'https://www.runninghub.cn/openapi/v2/vidu/start-end-to-video-q3-pro', model: 'vidu' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 1, max: 16, unit: 's' }
        ]
    },
    {
        name:                       'Vidu Q3 Turbo · RH CN站',
        brand:                      'Vidu',
        description:                'RH CN站 Vidu Q3 Turbo 牌价（¥/秒）；文生、首帧、首尾帧同价。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Vidu Q3 Turbo',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['540p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '540p': 0.18, '720p': 0.27, '1080p': 0.35 },
        rhPriceRules: {
            'rate|text-to-video|540p|*|*|*': 0.18,
            'rate|text-to-video|720p|*|*|*': 0.27,
            'rate|text-to-video|1080p|*|*|*': 0.35,
            'rate|first-frame|540p|*|*|*': 0.18,
            'rate|first-frame|720p|*|*|*': 0.27,
            'rate|first-frame|1080p|*|*|*': 0.35,
            'rate|i2v-first-last-frame|540p|*|*|*': 0.18,
            'rate|i2v-first-last-frame|720p|*|*|*': 0.27,
            'rate|i2v-first-last-frame|1080p|*|*|*': 0.35
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.cn/openapi/v2/vidu/text-to-video-q3-turbo', model: 'vidu' },
            'first-frame': { url: 'https://www.runninghub.cn/openapi/v2/vidu/image-to-video-q3-turbo', model: 'vidu' },
            'i2v-first-last-frame': { url: 'https://www.runninghub.cn/openapi/v2/vidu/start-end-to-video-q3-turbo', model: 'vidu' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Vidu Q3 Reference · RH CN站',
        brand:                      'Vidu',
        description:                'RH CN站 Vidu Q3 独立参考生视频。支持 1–7 张参考图、3–16 秒和 540p/720p/1080p。',
        timeEstimate:               '15min',
        provider:                   'RunningHubVideoProvider',
        source:                     'runninghub',
        canonicalModel:             'Vidu Q3 Reference',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['540p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { '540p': 0.22, '720p': 0.44, '1080p': 0.55 },
        rhPriceRules: {
            'rate|reference-video|540p|*|*|*': 0.22,
            'rate|reference-video|720p|*|*|*': 0.44,
            'rate|reference-video|1080p|*|*|*': 0.55
        },
        videoModes: [
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 7 } }
        ],
        endpoint: {
            'reference-video': { url: 'https://www.runninghub.cn/openapi/v2/vidu/reference-to-video-q3', model: 'vidu' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 16, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Fast · RH AI站',
        brand:                      'Seedance',
        description:                'RH AI站 Seedance 2.0 Fast 当前画布人民币价；无参考按生成秒计费，有参考按 RH 时长档计费。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Seedance 2.0 Fast',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.56, '720p': 1.12, '1080p': 1.40, '2k': 1.54, '4k': 1.75 },
        rhPriceRules: {
            'rate|text-to-video|480p|*|*|*': 0.56,
            'rate|text-to-video|720p|*|*|*': 1.12,
            'rate|text-to-video|1080p|*|*|*': 1.40,
            'rate|text-to-video|2k|*|*|*': 1.54,
            'rate|text-to-video|4k|*|*|*': 1.75,
            'rate|first-frame|480p|*|*|*': 0.56,
            'rate|first-frame|720p|*|*|*': 1.12,
            'rate|first-frame|1080p|*|*|*': 1.40,
            'rate|first-frame|2k|*|*|*': 1.54,
            'rate|first-frame|4k|*|*|*': 1.75,
            'rate|multimodal|480p|*|*|0': 0.56,
            'rate|multimodal|720p|*|*|0': 1.12,
            'rate|multimodal|1080p|*|*|0': 1.40,
            'rate|multimodal|2k|*|*|0': 1.54,
            'rate|multimodal|4k|*|*|0': 1.75,
            'floor-rate|multimodal|480p|*|*|1+': 0.35,
            'floor-rate|multimodal|720p|*|*|1+': 0.70,
            'floor-rate|multimodal|1080p|*|*|1+': 0.70,
            'floor-rate|multimodal|2k|*|*|1+': 0.70,
            'floor-rate|multimodal|4k|*|*|1+': 0.70,
            'floor-duration|multimodal|*|4|*|1+': 7,
            'floor-duration|multimodal|*|5|*|1+': 9,
            'floor-duration|multimodal|*|6|*|1+': 10,
            'floor-duration|multimodal|*|7|*|1+': 12,
            'floor-duration|multimodal|*|8|*|1+': 14,
            'floor-duration|multimodal|*|9|*|1+': 15,
            'floor-duration|multimodal|*|10|*|1+': 17,
            'floor-duration|multimodal|*|11|*|1+': 19,
            'floor-duration|multimodal|*|12|*|1+': 20,
            'floor-duration|multimodal|*|13|*|1+': 22,
            'floor-duration|multimodal|*|14|*|1+': 24,
            'floor-duration|multimodal|*|15|*|1+': 25,
            'surcharge-rate|multimodal|1080p|*|*|1+': 0.28,
            'surcharge-rate|multimodal|2k|*|*|1+': 0.42,
            'surcharge-rate|multimodal|4k|*|*|1+': 0.63
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video/sparkvideo-2.0-fast/text-to-video', model: 'sparkvideo-2.0-fast' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video/sparkvideo-2.0-fast/image-to-video', model: 'sparkvideo-2.0-fast' },
            'multimodal': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video/sparkvideo-2.0-fast/multimodal-video', model: 'sparkvideo-2.0-fast' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling O3 · RH AI站',
        brand:                      'Kling',
        description:                'RH AI站 Kling O3 带声音牌价（¥/秒）。与 CN 站为独立账号和 API Key；文生/首帧、参考、编辑分别计费。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Kling O3',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.70, '1080p': 0.70 },
        costByMode: {
            'text-to-video': { '720p': 0.70, '1080p': 0.70 },
            'first-frame': { '720p': 0.70, '1080p': 0.70 },
            'reference-video': { '720p': 0.70, '1080p': 0.70 },
            'video-edit': { '720p': 0.77, '1080p': 0.77 }
        },
        rhPriceRules: {
            'rate|text-to-video|*|*|*|*': 0.70,
            'rate|text-to-video|*|*|false|*': 0.56,
            'rate|first-frame|*|*|*|*': 0.70,
            'rate|first-frame|*|*|false|*': 0.56,
            'rate|reference-video|*|*|*|*': 0.70,
            'rate|reference-video|*|*|false|*': 0.56,
            'input-video-rate|video-edit|*|*|*|*': 0.77
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 9 } },
            { label: '视频编辑', value: 'video-edit', allowedInputs: { 'text': 10, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/kling-video-o3-std/text-to-video', model: 'kling-video-o3-std' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/kling-video-o3-std/image-to-video', model: 'kling-video-o3-std' },
            'reference-video': { url: 'https://www.runninghub.ai/openapi/v2/kling-video-o3-std/reference-to-video', model: 'kling-video-o3-std' },
            'video-edit': { url: 'https://www.runninghub.ai/openapi/v2/kling-video-o3-std/video-edit', model: 'kling-video-o3-std' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling O3 Pro · RH AI站',
        brand:                      'Kling',
        description:                'RH AI站 Kling O3 Pro 带声音牌价（¥/秒）。与 CN 站为独立账号和 API Key；文生/首帧、参考、编辑分别计费。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Kling O3',
        variantLabel:               'Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.91, '1080p': 0.91 },
        costByMode: {
            'text-to-video': { '720p': 0.91, '1080p': 0.91 },
            'first-frame': { '720p': 0.91, '1080p': 0.91 },
            'reference-video': { '720p': 0.91, '1080p': 0.91 },
            'video-edit': { '720p': 1.05, '1080p': 1.05 }
        },
        rhPriceRules: {
            'rate|text-to-video|*|*|*|*': 0.91,
            'rate|text-to-video|*|*|false|*': 0.70,
            'rate|first-frame|*|*|*|*': 0.91,
            'rate|first-frame|*|*|false|*': 0.70,
            'rate|reference-video|*|*|*|*': 0.91,
            'rate|reference-video|*|*|false|*': 0.70,
            'input-video-rate|video-edit|*|*|*|*': 1.05
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 7 } },
            { label: '视频编辑', value: 'video-edit', allowedInputs: { 'text': 10, 'image': 4, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/kling-video-o3-pro/text-to-video', model: 'kling-video-o3-pro' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/kling-video-o3-pro/image-to-video', model: 'kling-video-o3-pro' },
            'reference-video': { url: 'https://www.runninghub.ai/openapi/v2/kling-video-o3-pro/reference-to-video', model: 'kling-video-o3-pro' },
            'video-edit': { url: 'https://www.runninghub.ai/openapi/v2/kling-video-o3-pro/video-edit', model: 'kling-video-o3-pro' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Vidu Q3 Turbo · RH AI站',
        brand:                      'Vidu',
        description:                'RH AI站 Vidu Q3 Turbo 牌价（¥/秒）。与 CN 站为独立账号和 API Key；文生、首帧、首尾帧同价。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Vidu Q3 Turbo',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['540p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '540p': 0.21, '720p': 0.28, '1080p': 0.42 },
        rhPriceRules: {
            'rate|text-to-video|540p|*|*|*': 0.21,
            'rate|text-to-video|720p|*|*|*': 0.28,
            'rate|text-to-video|1080p|*|*|*': 0.42,
            'rate|first-frame|540p|*|*|*': 0.21,
            'rate|first-frame|720p|*|*|*': 0.28,
            'rate|first-frame|1080p|*|*|*': 0.42,
            'rate|i2v-first-last-frame|540p|*|*|*': 0.21,
            'rate|i2v-first-last-frame|720p|*|*|*': 0.28,
            'rate|i2v-first-last-frame|1080p|*|*|*': 0.42
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/vidu/text-to-video-q3-turbo', model: 'vidu' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/vidu/image-to-video-q3-turbo', model: 'vidu' },
            'i2v-first-last-frame': { url: 'https://www.runninghub.ai/openapi/v2/vidu/start-end-to-video-q3-turbo', model: 'vidu' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Vidu Q3 Reference · RH AI站',
        brand:                      'Vidu',
        description:                'RH AI站 Vidu Q3 独立参考生视频。与 CN 站为独立账号和 API Key；支持 1–7 张参考图、3–16 秒和 540p/720p/1080p。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Vidu Q3 Reference',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['540p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3"],
        cost:                       { '540p': 0.28, '720p': 0.49, '1080p': 0.63 },
        rhPriceRules: {
            'rate|reference-video|540p|*|*|*': 0.28,
            'rate|reference-video|720p|*|*|*': 0.49,
            'rate|reference-video|1080p|*|*|*': 0.63
        },
        videoModes: [
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 7 } }
        ],
        endpoint: {
            'reference-video': { url: 'https://www.runninghub.ai/openapi/v2/vidu/reference-to-video-q3', model: 'vidu' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 16, unit: 's' }
        ]
    },
    {
        name:                       'Grok · RH AI站',
        brand:                      'Grok',
        description:                'RH AI站 Grok-官方稳定版。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Grok',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['480p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.56, '720p': 0.98, '1080p': 1.75 },
        rhPriceRules: {
            'rate|text-to-video|480p|*|*|*': 0.56,
            'rate|text-to-video|720p|*|*|*': 0.98,
            'rate|text-to-video|1080p|*|*|*': 1.75,
            'rate|first-frame|480p|*|*|*': 0.56,
            'rate|first-frame|720p|*|*|*': 0.98,
            'image-surcharge|first-frame|*|0|*|1+': 0.07,
            'rate|reference-video|480p|*|*|*': 0.56,
            'rate|reference-video|720p|*|*|*': 0.98,
            'image-surcharge|reference-video|*|0|*|1+': 0.07,
            'input-video-rate|video-edit|*|*|*|*': 0.42,
            'total|video-extend|*|6|*|*': 1.89,
            'total|video-extend|*|10|*|*': 3.15
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 9 } },
            { label: '视频编辑', value: 'video-edit', allowedInputs: { 'text': 10, 'video': 1 } },
            { label: '视频延长', value: 'video-extend', allowedInputs: { 'text': 10, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-g-official/text-to-video-v1.5', model: 'rhart-video-g-official' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-g-official/image-to-video-v1.5', model: 'rhart-video-g-official' },
            'reference-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-g-official/reference-to-video-v1.5', model: 'rhart-video-g-official' },
            'video-edit': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-g-official/edit-video', model: 'rhart-video-g-official' },
            'video-extend': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-g-official/video-extend', model: 'rhart-video-g-official' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Grok · RH AI站低价',
        brand:                      'Grok',
        description:                'RH AI站 Grok-低价渠道版。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Grok',
        tier:                       'budget',
        premium:                    true,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['480p', '720p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.21, '720p': 0.21 },
        rhPriceRules: {
            'rate|text-to-video|480p|*|*|*': 0.21,
            'rate|text-to-video|720p|*|*|*': 0.21,
            'rate|first-frame|480p|*|*|*': 0.21,
            'rate|first-frame|720p|*|*|*': 0.21
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-g/text-to-video', model: 'rhart-video-g' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-g/image-to-video', model: 'rhart-video-g' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 6, min: 6, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Veo 3.1 Lite · RH AI站',
        brand:                      'Veo',
        description:                'RH AI站 Veo-Lite。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Veo 3.1 Lite',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              8,
        cost:                       { '720p': 0.35, '1080p': 0.56 },
        rhPriceRules: {
            'rate|text-to-video|720p|8|*|*': 0.35,
            'rate|text-to-video|1080p|8|*|*': 0.56,
            'rate|first-frame|720p|8|*|*': 0.35,
            'rate|first-frame|1080p|8|*|*': 0.56,
            'total|i2v-first-last-frame|720p|8|*|*': 2.52,
            'total|i2v-first-last-frame|1080p|8|*|*': 4.06
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-lite-official/text-to-video', model: 'rhart-video-v3.1-lite-official' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-lite-official/image-to-video', model: 'rhart-video-v3.1-lite-official' },
            'i2v-first-last-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-lite-official/start-end-to-video', model: 'rhart-video-v3.1-lite-official' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Veo 3.1 Fast · RH AI站',
        brand:                      'Veo',
        description:                'RH AI站 Veo-Fast。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Veo 3.1 Fast',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              8,
        cost:                       { '720p': 0.8925, '1080p': 0.8925, '4k': 0.8925 },
        rhPriceRules: {
            'total|text-to-video|720p|8|*|*': 7.14,
            'total|text-to-video|720p|8|false|*': 4.76,
            'total|text-to-video|1080p|8|*|*': 7.14,
            'total|text-to-video|1080p|8|false|*': 4.76,
            'total|text-to-video|4k|8|*|*': 7.14,
            'total|text-to-video|4k|8|false|*': 4.76,
            'total|first-frame|720p|8|*|*': 7.14,
            'total|first-frame|720p|8|false|*': 4.76,
            'total|first-frame|1080p|8|*|*': 7.14,
            'total|first-frame|1080p|8|false|*': 4.76,
            'total|first-frame|4k|8|*|*': 7.14,
            'total|first-frame|4k|8|false|*': 4.76,
            'total|reference-video|720p|8|*|*': 5.04,
            'total|reference-video|720p|8|false|*': 4.06,
            'total|reference-video|1080p|8|*|*': 6.02,
            'total|reference-video|1080p|8|false|*': 5.04,
            'total|video-extend|*|8|*|*': 6.65
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 9 } },
            { label: '视频延长', value: 'video-extend', allowedInputs: { 'text': 10, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-fast-official/text-to-video', model: 'rhart-video-v3.1-fast-official' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-fast-official/image-to-video', model: 'rhart-video-v3.1-fast-official' },
            'reference-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-fast-official/reference-to-video', model: 'rhart-video-v3.1-fast-official' },
            'video-extend': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-fast-official/video-extend', model: 'rhart-video-v3.1-fast-official' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Veo 3.1 Pro · RH AI站',
        brand:                      'Veo',
        description:                'RH AI站 Veo-Pro。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Veo 3.1 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              8,
        cost:                       { '720p': 2.38, '1080p': 2.38, '4k': 2.38 },
        rhPriceRules: {
            'total|text-to-video|720p|8|*|*': 19.04,
            'total|text-to-video|720p|8|false|*': 9.52,
            'total|text-to-video|1080p|8|*|*': 19.04,
            'total|text-to-video|1080p|8|false|*': 9.52,
            'total|text-to-video|4k|8|*|*': 19.04,
            'total|text-to-video|4k|8|false|*': 9.52,
            'total|first-frame|720p|8|*|*': 19.04,
            'total|first-frame|720p|8|false|*': 9.52,
            'total|first-frame|1080p|8|*|*': 19.04,
            'total|first-frame|1080p|8|false|*': 9.52,
            'total|first-frame|4k|8|*|*': 19.04,
            'total|first-frame|4k|8|false|*': 9.52,
            'total|reference-video|720p|8|*|*': 19.04,
            'total|reference-video|720p|8|false|*': 9.52,
            'total|reference-video|1080p|8|*|*': 19.04,
            'total|reference-video|1080p|8|false|*': 9.52,
            'total|reference-video|4k|8|*|*': 19.04,
            'total|reference-video|4k|8|false|*': 9.52,
            'total|video-extend|*|8|*|*': 17.64
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 9 } },
            { label: '视频延长', value: 'video-extend', allowedInputs: { 'text': 10, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-pro-official/text-to-video', model: 'rhart-video-v3.1-pro-official' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-pro-official/image-to-video', model: 'rhart-video-v3.1-pro-official' },
            'reference-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-pro-official/reference-to-video', model: 'rhart-video-v3.1-pro-official' },
            'video-extend': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-pro-official/video-extend', model: 'rhart-video-v3.1-pro-official' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Veo 3.1 Fast · RH AI站低价',
        brand:                      'Veo',
        description:                'RH AI站 Veo-Fast-低价渠道版。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Veo 3.1 Fast',
        tier:                       'budget',
        premium:                    true,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              8,
        cost:                       { '720p': 0.175, '1080p': 0.175, '4k': 0.175 },
        rhPriceRules: {
            'total|text-to-video|720p|8|*|*': 1.40,
            'total|text-to-video|1080p|8|*|*': 1.40,
            'total|text-to-video|4k|8|*|*': 1.40,
            'total|first-frame|720p|8|*|*': 1.40,
            'total|first-frame|1080p|8|*|*': 1.40,
            'total|first-frame|4k|8|*|*': 1.40,
            'total|i2v-first-last-frame|720p|8|*|*': 1.40,
            'total|i2v-first-last-frame|1080p|8|*|*': 1.40,
            'total|i2v-first-last-frame|4k|8|*|*': 1.40
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-fast/text-to-video', model: 'rhart-video-v3.1-fast' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-fast/image-to-video', model: 'rhart-video-v3.1-fast' },
            'i2v-first-last-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-fast/start-end-to-video', model: 'rhart-video-v3.1-fast' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Veo 3.1 Pro · RH AI站低价',
        brand:                      'Veo',
        description:                'RH AI站 Veo-Pro-低价渠道版。版本切法与 RunningHub 自己的模型选择器一致。',
        timeEstimate:               '15min',
        provider:                   'RunningHubGlobalVideoProvider',
        source:                     'runninghub_global',
        canonicalModel:             'Veo 3.1 Pro',
        tier:                       'budget',
        premium:                    true,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p', '1080p', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              8,
        cost:                       { '720p': 0.11375, '1080p': 0.14875, '4k': 0.20125 },
        rhPriceRules: {
            'total|text-to-video|720p|8|*|*': 0.91,
            'total|text-to-video|1080p|8|*|*': 1.19,
            'total|text-to-video|4k|8|*|*': 1.61,
            'total|first-frame|720p|8|*|*': 0.91,
            'total|first-frame|1080p|8|*|*': 1.19,
            'total|first-frame|4k|8|*|*': 1.61,
            'total|i2v-first-last-frame|720p|8|*|*': 0.91,
            'total|i2v-first-last-frame|1080p|8|*|*': 1.19,
            'total|i2v-first-last-frame|4k|8|*|*': 1.61
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-pro/text-to-video', model: 'rhart-video-v3.1-pro' },
            'first-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-pro/image-to-video', model: 'rhart-video-v3.1-pro' },
            'i2v-first-last-frame': { url: 'https://www.runninghub.ai/openapi/v2/rhart-video-v3.1-pro/start-end-to-video', model: 'rhart-video-v3.1-pro' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Standard · API',
        description:                'AIFISHER API seedance-2.0-standard。文生视频以 480p 付费账单校准，其他分辨率按同执行路由的既有分辨率比例估算；模式之间不套价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Seedance 2.0',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.558, '720p': 1.19, '1080p': 1.539, '2k': 1.684, '4k': 1.932 },
        costByMode: {
            'text-to-video': { '480p': 0.462, '720p': 0.9853, '1080p': 1.2742, '2k': 1.3943, '4k': 1.5996 }
        },
        estimatedCostByMode:        ['text-to-video'],
        observedTaskCost: {
            'text-to-video|480p|4|images=0|audio=false': 1.848
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-standard-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-standard-i2v' },
            'multimodal': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-standard-multi' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Fast · API',
        description:                'AIFISHER API seedance-2.0-fast。文生 720p 以 4 秒付费账单校准最低展示价；其他模式继续使用各自证据。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Seedance 2.0 Fast',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.3598, '720p': 0.3303, '1080p': 1.2028 },
        costByMode: {
            'text-to-video': { '480p': 0.3298, '720p': 0.3303, '1080p': 1.2028 },
            'first-frame': { '480p': 0.3604, '720p': 0.7736, '1080p': 1.1991 },
            'multimodal': { '480p': 0.3598, '720p': 0.7704, '1080p': 1.2028 }
        },
        estimatedCostByMode:        ['text-to-video'],
        observedTaskCost: {
            'text-to-video|480p|5|images=0|audio=omitted': 1.648984,
            'text-to-video|720p|4|images=0|audio=false': 1.3213538461538463,
            'first-frame|720p|5': 3.868061538461539,
            'multimodal|720p|5': 3.868061538461539
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-fast-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-fast-i2v' },
            'multimodal': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-fast-multi' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Mini · API',
        description:                'AIFISHER API seedance-2.0-mini。首帧 720p 以 15 秒付费账单校准，480p 按同模式 Token 比例估算；文生、首帧和全能参考分开核价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Seedance 2.0 Mini',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.1399, '720p': 0.3435 },
        costByMode: {
            'text-to-video': { '480p': 0.1399, '720p': 0.3435 },
            'first-frame': { '480p': 0.1274, '720p': 0.2741 },
            'multimodal': { '480p': 0.1399, '720p': 0.3007 }
        },
        estimatedCostByMode:        ['first-frame'],
        priceNoteByMode: {
            'first-frame': '首帧 720p/15秒（1张输入图、默认音频行为）已有实测账单；其他参数仍为近似价格，最终以任务账单为准'
        },
        observedTaskCost: {
            'text-to-video|720p|5': 1.7177142857142857,
            'multimodal|720p|5': 1.5034285714285713,
            'first-frame|720p|15|images=1|audio=omitted': 4.110856
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-mini-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-mini-i2v' },
            'multimodal': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-mini-multi' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.0 Fast · API宽审核',
        description:                'AIFISHER Agent 中转线路 Seedance 2.0 Global Fast；宽审核。文生 15 秒按当前只读估价校准展示基准，其他模式继续按各自证据核价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Seedance 2.0 Fast',
        variantLabel:               '宽审核',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  16,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ['1:1', '9:16', '16:9', '3:4', '4:3', '21:9'],
        cost:                       { '480p': 0.4113, '720p': 0.8845, '1080p': 1.2959, '2k': 1.4486 },
        costByMode: {
            'text-to-video': { '480p': 0.4103, '720p': 0.3744652 },
            'multimodal': { '480p': 0.4113, '720p': 0.8845, '1080p': 1.2959, '2k': 1.4486 }
        },
        priceNoteByMode: {
            'text-to-video': '当前文生 15 秒只读估价约 ¥5.62；分辨率未进入上游活跃计价特征，仍按近似价格展示',
            'first-frame': '中转站该模式缺少可对应分辨率与时长的实测账单'
        },
        estimatedCostByMode:        ['text-to-video'],
        observedTaskCost: {
            'multimodal|480p|5': 2.056746268656716,
            'multimodal|720p|5': 4.4225373134328345,
            'multimodal|1080p|5': 6.479283582089551
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 1 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 1, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 1, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-fast-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-fast-i2v' },
            'multimodal': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-fast-multi' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 2, max: 15, unit: 's' },
            { key: 'generate_audio', label: '生成声音', type: 'toggle', default: true },
            { key: 'seed', label: 'Seed', type: 'number', default: -1, min: -1, max: 2147483647 },
            { key: 'return_last_frame', label: '返回尾帧', type: 'toggle', default: false }
        ]
    },
    {
        name:                       'Seedance 2.0 Mini · API宽审核',
        description:                'AIFISHER Agent 中转线路 Seedance 2.0 Global Mini；宽审核。价格按当前模式、分辨率与时长动态匹配历史估价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Seedance 2.0 Mini',
        variantLabel:               '宽审核',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  16,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ['1:1', '9:16', '16:9', '3:4', '4:3', '21:9'],
        cost:                       { '480p': 0.1673, '720p': 0.3621, '1080p': 0.5494 },
        costByMode: {
            'first-frame': { '480p': 0.1673, '720p': 0.3621, '1080p': 0.5494 }
        },
        priceNoteByMode: {
            'text-to-video': '中转站该模式缺少可对应分辨率与时长的实测账单',
            'multimodal': '中转站该模式缺少可对应分辨率与时长的实测账单'
        },
        observedTaskCost: {
            'first-frame|720p|5': 1.8105405405405406
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 1 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 1, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 1, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-mini-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-mini-i2v' },
            'multimodal': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-mini-multi' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 2, max: 15, unit: 's' },
            { key: 'generate_audio', label: '生成声音', type: 'toggle', default: true },
            { key: 'seed', label: 'Seed', type: 'number', default: -1, min: -1, max: 2147483647 },
            { key: 'return_last_frame', label: '返回尾帧', type: 'toggle', default: false }
        ]
    },
    {
        name:                       'Seedance 2.0 Standard · API宽审核',
        description:                'AIFISHER Agent 中转线路 Seedance 2.0 Global Standard；宽审核。720p 文生与首帧按当前 15 秒历史证据估算，多参按当前分辨率曲线估算。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Seedance 2.0',
        variantLabel:               '宽审核',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  16,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k', 'native1080p', 'native4k'],
        aspectRatios:               ['1:1', '9:16', '16:9', '3:4', '4:3', '21:9'],
        cost:                       { '480p': 0.5405, '720p': 1.1222, '1080p': 3.158, '2k': 3.158, '4k': 3.158, 'native1080p': 3.158, 'native4k': 3.158 },
        costByMode: {
            'text-to-video': { '480p': 0.5405, '720p': 1.1222 },
            'first-frame': { '720p': 1.1222 },
            'multimodal': { '480p': 0.5219, '720p': 1.1222, '1080p': 1.4183, '2k': 1.5663 }
        },
        estimatedCostByMode:        ['text-to-video', 'first-frame', 'multimodal'],
        priceNoteByMode: {
            'multimodal': '按当前宽审核多参线路的分辨率与时长历史证据估算'
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 1 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 1, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 1, 'image': 9, 'video': 3, 'audio': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-standard-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-standard-i2v' },
            'multimodal': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.0-global-standard-multi' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 2, max: 15, unit: 's' },
            { key: 'generate_audio', label: '生成声音', type: 'toggle', default: true },
            { key: 'seed', label: 'Seed', type: 'number', default: -1, min: -1, max: 2147483647 },
            { key: 'return_last_frame', label: '返回尾帧', type: 'toggle', default: false }
        ]
    },
    {
        name:                       '可灵 V3 · API',
        description:                'AIFISHER API kling-v3.0-std。价格按当前模式、分辨率与时长动态匹配历史估价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Kling V3.0',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p', '1080p', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.7993, '1080p': 0.9588 },
        costByMode: {
            'text-to-video': { '720p': 0.958941 }
        },
        observedTaskCost: {
            'text-to-video|720p|4|images=0|audio=omitted': 3.835765
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3.0-std-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3.0-std-i2v' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       '可灵 V3 Pro · API',
        description:                'AIFISHER API kling-v3.0-pro。价格按当前模式、分辨率与时长动态匹配历史估价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Kling V3.0',
        variantLabel:               'Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 1.27875, '1080p': 1.27875 },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3.0-pro-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3.0-pro-i2v' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling O3 · API',
        description:                'AIFISHER API kling-o3-std。价格按当前模式、分辨率与时长动态匹配历史估价；缺少证据的模式不猜价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Kling O3',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.7776083, '1080p': 0.7776083 },
        costByMode: {
            'text-to-video': { '720p': 0.6392941, '1080p': 0.6392941 },
            'video-edit': { '720p': 0.9128167, '1080p': 0.9128167 }
        },
        estimatedCostByMode:        ['text-to-video'],
        observedTaskCost: {
            'text-to-video|720p|4|images=0|audio=false': 2.557176
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '视频参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 9 } },
            { label: '视频编辑', value: 'video-edit', allowedInputs: { 'text': 10, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-o3-std-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-o3-std-i2v' },
            'reference-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-o3-std-r2v' },
            'video-edit': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-o3-std-edit' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Kling O3 Pro · API',
        description:                'AIFISHER API kling-o3-pro。价格按当前模式、分辨率与时长动态匹配历史估价；缺少证据的模式不猜价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Kling O3',
        variantLabel:               'Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 1.0696, '1080p': 1.0696 },
        costByMode: {
            'text-to-video': { '720p': 1.0696, '1080p': 1.0696 }
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '视频参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 9 } },
            { label: '视频编辑', value: 'video-edit', allowedInputs: { 'text': 10, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-o3-pro-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-o3-pro-i2v' },
            'reference-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-o3-pro-r2v' },
            'video-edit': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-o3-pro-edit' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       '豆包视频2.0',
        canonicalModel:             'Seedance 2.0',
        description:                '字节视频生成seedance 2.0',
        timeEstimate:               '5min',
        provider:                   'DoubaoVideoProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'audio', 'video'],
        cost: {
            '480p': 0.60,
            '720p': 1.35,
            '1080p': 1.35
        },
        resolutions:                ['480p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多模态', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'audio': 3, 'video': 3 } },
        ],
        endpoint: {
            'text-to-video': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
                model: 'doubao-seedance-2-0-260128'
            },
            'i2v-first-last-frame': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
                model: 'doubao-seedance-2-0-260128'
            },
            'multimodal': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
                model: 'doubao-seedance-2-0-260128'
            }
        },
        generate_audio:             true,
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 4, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       '豆包视频2.0 fast',
        canonicalModel:             'Seedance 2.0 Fast',
        description:                '字节视频生成seedance 2.0 fast',
        timeEstimate:               '5min',
        provider:                   'DoubaoVideoProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'audio', 'video'],
        cost: {
            '480p': 0.37,
            '720p': 1.35,
            '1080p': 1.35
        },
        resolutions:                ['480p', '720p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 1 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 1, 'image': 2 } },
            { label: '多模态', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 9, 'audio': 3, 'video': 3 } },
        ],
        endpoint: {
            'text-to-video': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
                model: 'doubao-seedance-2-0-fast-260128'
            },
            'i2v-first-last-frame': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
                model: 'doubao-seedance-2-0-fast-260128'
            },
            'multimodal': {
                url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
                model: 'doubao-seedance-2-0-fast-260128'
            }
        },
        generate_audio:             true,
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 4, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       '可灵 Kling-V3',
        canonicalModel:             'Kling V3.0',
        description:                '快手旗舰级视频生成模型 V3',
        timeEstimate:               '5min',
        provider:                   'KlingVideoProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        cost: {
            '720p': 0.8,
            '1080p': 1.2
        },
        resolutions:                ['720p'],
        aspectRatios:               ["1:1", "9:16", "16:9"],
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '动作控制', value: 'motion-control', allowedInputs: { 'text': 10, 'image': 1, 'video': 1 } },
        ],
        endpoint: {
            'text-to-video': {
                url: 'https://api-beijing.klingai.com/v1/videos/text2video',
                model: 'kling-v3'
            },
            'i2v-first-last-frame': {
                url: 'https://api-beijing.klingai.com/v1/videos/image2video',
                model: 'kling-v3'
            },
            'motion-control': {
                url: 'https://api-beijing.klingai.com/v1/videos/motion-control',
                model: 'kling-v3'
            }
        },
        generate_audio:             true,
        advancedParams: [
            {
                key: 'mode', label: '模式', type: 'select', default: 'std', options: [
                    { label: '标准', value: 'std' },
                    { label: '高级', value: 'pro' },
                    { label: '4K', value: '4k' }
                ]
            },
            {
                key: 'character_orientation', label: '动作朝向', type: 'select', default: 'video', options: [
                    { label: '按图片角色', value: 'image' },
                    { label: '按视频角色', value: 'video' }
                ]
            },
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 15, unit: 's' }
        ]
    },
    {
        name:                       '可灵 Kling-V3-Omni',
        canonicalModel:             'Kling O3',
        description:                '快手旗舰级全模态视频生成模型',
        timeEstimate:               '5min',
        provider:                   'KlingVideoProvider',
        selectable:                 false,
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        cost: {
            '720p': 0.8,
            '1080p': 1.2
        },
        resolutions:                ['720p'],
        aspectRatios:               ["1:1", "9:16", "16:9"],
        videoModes: [
            { label: '文生视频', value: 'omni-text-to-video', allowedInputs: { 'text': 10 } },
            { label: '图生视频', value: 'omni-image-to-video', allowedInputs: { 'text': 10, 'image': 4 } },
            { label: '首尾帧', value: 'omni-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '视频编辑', value: 'omni-video-edit', allowedInputs: { 'text': 10, 'image': 4, 'video': 1 } },
            { label: '视频参考', value: 'omni-video-ref', allowedInputs: { 'text': 10, 'image': 4, 'video': 1 } },
        ],
        endpoint: {
            'omni-text-to-video': {
                url: 'https://api-beijing.klingai.com/v1/videos/omni-video',
                model: 'kling-v3-omni'
            },
            'omni-image-to-video': {
                url: 'https://api-beijing.klingai.com/v1/videos/omni-video',
                model: 'kling-v3-omni'
            },
            'omni-first-last-frame': {
                url: 'https://api-beijing.klingai.com/v1/videos/omni-video',
                model: 'kling-v3-omni'
            },
            'omni-video-edit': {
                url: 'https://api-beijing.klingai.com/v1/videos/omni-video',
                model: 'kling-v3-omni'
            },
            'omni-video-ref': {
                url: 'https://api-beijing.klingai.com/v1/videos/omni-video',
                model: 'kling-v3-omni'
            }
        },
        generate_audio:             true,
        advancedParams: [
            {
                key: 'mode', label: '模式', type: 'select', default: 'std', options: [
                    { label: '标准', value: 'std' },
                    { label: '高级', value: 'pro' },
                    { label: '4K', value: '4k' }
                ]
            },
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 10, unit: 's' }
        ]
    },
    {
        name:                       '谷歌OMNI Flash · API',
        brand:                      '谷歌OMNI',
        description:                'AIFISHER API g-omni-flash，多模态视频：文生 / 多图参考 / 视频编辑。只有 720p，时长不可指定；当前 10% 加价下按条约 ¥7.81（折算到 5 秒展示口径）。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             '谷歌OMNI Flash',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  16,
        supportedReferenceTypes:    ['text', 'image', 'video'],
        resolutions:                ['720p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              5,
        cost:                       { '720p': 1.561456 },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 16 } },
            { label: '视频编辑', value: 'video-edit', allowedInputs: { 'text': 10, 'video': 1 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-g-omni-flash' },
            'reference-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-g-omni-flash' },
            'video-edit': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-g-omni-flash' }
        }
    },
    {
        name:                       'MiniMax H3 · API',
        brand:                      'MiniMax',
        description:                'AIFISHER Agent 中转线路 MiniMax H3 Fast；OW 只保留在底层路由，不进入展示名。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'MiniMax H3',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['480p', '720p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.066, '720p': 0.132 },
        costByMode: {
            'first-frame': { '480p': 0.066, '720p': 0.132 }
        },
        estimatedCostByMode:        ['first-frame'],
        observedTaskCost: {
            'first-frame|720p|15|images=1|audio=omitted': 2.2
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 1 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 9 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'minimax-h3-ow-t2v-fast' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'minimax-h3-ow-i2v-fast' },
            'reference-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'minimax-h3-ow-r2v-fast' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 5, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.5 Standard · API',
        brand:                      'Seedance',
        description:                'AIFISHER API seedance-2.5-standard。文生 480p/720p 均以 4 秒付费账单校准最低展示价；其他模式继续使用各自证据。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Seedance 2.5',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  50,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.904, '720p': 1.5966 },
        costByMode: {
            'text-to-video': { '480p': 0.7103, '720p': 1.5966 },
            'first-frame': { '480p': 0.9053, '720p': 2.0205 }
        },
        estimatedCostByMode:        ['text-to-video'],
        observedTaskCost: {
            'text-to-video|480p|4|images=0|audio=false': 2.841112,
            'text-to-video|720p|4|images=0|audio=false': 6.38625625,
            'first-frame|720p|10': 20.205333
        },
        priceNoteByMode: {
            'multimodal': '中转站该模式暂无实测账单'
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 30, 'video': 10, 'audio': 10 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.5-standard-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.5-standard-i2v' },
            'multimodal': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.5-standard-multi' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 30, unit: 's' }
        ]
    },
    {
        name:                       'Seedance 2.5 Standard · API宽审核',
        brand:                      'Seedance',
        variantLabel:               '宽审核',
        description:                'AIFISHER API Seedance 2.5 global 宽审核线路。价格按当前模式、分辨率与时长动态匹配历史估价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Seedance 2.5',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  50,
        supportedReferenceTypes:    ['text', 'image', 'video', 'audio'],
        resolutions:                ['480p', '720p', '1080p', '2k', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        costByMode: {
            'text-to-video': { '480p': 0.9778, '720p': 2.201, '1080p': 2.5389, '4k': 2.8834 },
            'first-frame': { '480p': 1.0042, '720p': 2.1916, '1080p': 2.5323, '4k': 2.8711 }
        },
        observedTaskCost: {
            'text-to-video|720p|15': 32.826067,
            'first-frame|720p|15': 32.826067,
            'first-frame|720p|30': 66.010787
        },
        priceNoteByMode: {
            'multimodal': '中转站该模式暂无实测账单'
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '全能参考', value: 'multimodal', allowedInputs: { 'text': 10, 'image': 30, 'video': 10, 'audio': 10 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.5-global-standard-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.5-global-standard-i2v' },
            'multimodal': { url: 'https://api.work-fisher.com/v1/videos', model: 'seedance-2.5-global-standard-multi' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 30, unit: 's' }
        ]
    },
    {
        name:                       'Kling V3 Turbo · API',
        brand:                      'Kling',
        description:                'AIFISHER API kling-v3-turbo-std。价格按当前模式、分辨率与时长动态匹配历史估价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Kling V3 Turbo',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.7278333, '1080p': 0.7278333 },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3-turbo-std-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3-turbo-std-i2v' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 5, max: 10, unit: 's' }
        ]
    },
    {
        name:                       'Kling V3 Turbo Pro · API',
        brand:                      'Kling',
        description:                'AIFISHER API kling-v3-turbo-pro。价格按当前模式、分辨率与时长动态匹配历史估价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Kling V3 Turbo',
        variantLabel:               'Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.9048417, '1080p': 0.9048417 },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3-turbo-pro-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3-turbo-pro-i2v' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 5, max: 10, unit: 's' }
        ]
    },
    {
        name:                       'Kling V3 4K · API',
        brand:                      'Kling',
        description:                'AIFISHER API kling-v3-4k。产品动态读取中转站历史估价；当前参数无可靠证据时不报数字。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Kling V3 4K',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        costByMode: {
            'first-frame': { '4k': 3.3194118 }
        },
        estimatedCostByMode:        ['first-frame'],
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3-4k-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'kling-v3-4k-i2v' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 5, max: 10, unit: 's' }
        ]
    },
    {
        name:                       'Vidu Q3 Pro · API',
        brand:                      'Vidu',
        description:                'AIFISHER API vidu-q3-pro。价格按当前模式、分辨率与时长动态匹配历史估价；无可靠证据时不报数字。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Vidu Q3 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.6897 },
        costByMode: {
            'i2v-first-last-frame': { '720p': 0.6897 }
        },
        estimatedCostByMode:        ['i2v-first-last-frame'],
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'vidu-q3-pro-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'vidu-q3-pro-i2v' },
            'i2v-first-last-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'vidu-q3-pro-start-end' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Vidu Q3 Turbo · API',
        brand:                      'Vidu',
        description:                'AIFISHER API vidu-q3-turbo。价格按当前模式、分辨率与时长动态匹配历史估价；缺失证据的模式不猜价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Vidu Q3 Turbo',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '720p': 0.28215, '1080p': 0.3656056 },
        costByMode: {
            'text-to-video': { '720p': 0.28215 },
            'first-frame': { '720p': 0.28215, '1080p': 0.3656056 },
            'i2v-first-last-frame': { '720p': 0.2822729 }
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '首尾帧', value: 'i2v-first-last-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'vidu-q3-turbo-t2v' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'vidu-q3-turbo-i2v' },
            'i2v-first-last-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'vidu-q3-turbo-start-end' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 4, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Vidu Q3 Reference · API',
        brand:                      'Vidu',
        description:                'AIFISHER API vidu-q3-r2v。支持 1–7 张主题参考图和 3–16 秒；当前参数无可靠历史估价时不报数字。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Vidu Q3 Reference',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['540p', '720p', '1080p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3"],
        videoModes: [
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 7 } }
        ],
        endpoint: {
            'reference-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'vidu-q3-r2v' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 5, min: 3, max: 16, unit: 's' }
        ]
    },
    {
        name:                       'Grok · API',
        brand:                      'Grok',
        description:                'AIFISHER API。画布开放时长 6–15 秒，参考图最多 7 张；价格按当前参数动态匹配历史估价。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Grok',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['480p', '720p'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        cost:                       { '480p': 0.1122, '720p': 0.132 },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 7 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-gk-v15' },
            'reference-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-gk-v15' }
        },
        advancedParams: [
            { key: 'duration', label: '生成时长', type: 'slider', default: 6, min: 6, max: 15, unit: 's' }
        ]
    },
    {
        name:                       'Veo Flash Lite · API',
        brand:                      'Veo',
        description:                'AIFISHER API。只做文生视频，时长固定 8 秒（不可调）；当前参数无可靠历史估价时不报数字。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Veo 3.1 Lite',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text'],
        resolutions:                ['720p', '1080p', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              8,
        cost:                       { '720p': 0.0842188 },
        observedTaskCost: {
            'text-to-video|720p|8|images=0|audio=omitted': 0.67375
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-v31-lite' }
        }
    },
    {
        name:                       'Veo 3.1 Flash · API',
        brand:                      'Veo',
        description:                'AIFISHER API。时长固定 8 秒（不可调），参考图 3 张走多图参考；无可靠历史估价时不报数字。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Veo 3.1 Fast',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['720p', '1080p', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              8,
        cost:                       { '720p': 0.1684375 },
        costByMode: {
            'text-to-video': { '720p': 0.1684375 },
            'first-frame': { '720p': 0.1684375 },
            'reference-video': { '720p': 0.1684375 }
        },
        estimatedCostByMode:        ['text-to-video', 'first-frame', 'reference-video'],
        observedTaskCost: {
            'text-to-video|720p|8|images=0|audio=false': 1.3475
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } },
            { label: '多图参考', value: 'reference-video', allowedInputs: { 'text': 10, 'image': 3 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-v31-fast' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-v31-fast' },
            'reference-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-v31-fast' }
        }
    },
    {
        name:                       'Veo 3.1 Pro · API',
        brand:                      'Veo',
        description:                'AIFISHER API。时长固定 8 秒（不可调），上游禁止多图参考；无可靠历史估价时不报数字。',
        timeEstimate:               '15min',
        provider:                   'RelayVideoProvider',
        source:                     'relay',
        canonicalModel:             'Veo 3.1 Pro',
        maxConcurrent:              0,
        useProxy:                   false,
        maxInputs:                  10,
        supportedReferenceTypes:    ['text', 'image'],
        resolutions:                ['720p', '1080p', '4k'],
        aspectRatios:               ["1:1", "9:16", "16:9", "3:4", "4:3", "21:9"],
        fixedDuration:              8,
        cost:                       { '720p': 1.925 },
        costByMode: {
            'text-to-video': { '720p': 1.925 },
            'first-frame': { '720p': 1.203125 }
        },
        estimatedCostByMode:        ['text-to-video', 'first-frame'],
        observedTaskCost: {
            'first-frame|720p|8|images=1|audio=omitted': 9.625
        },
        videoModes: [
            { label: '文生视频', value: 'text-to-video', allowedInputs: { 'text': 10 } },
            { label: '首帧', value: 'first-frame', allowedInputs: { 'text': 10, 'image': 2 } }
        ],
        endpoint: {
            'text-to-video': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-v31-quality' },
            'first-frame': { url: 'https://api.work-fisher.com/v1/videos', model: 'workfisher-video-v31-quality' }
        }
    },
];

export type ModelNodeType = NodeType;
