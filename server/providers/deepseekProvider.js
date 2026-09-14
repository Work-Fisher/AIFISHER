/**
 * deepseekProvider.js
 * 封装 DeepSeek 系列模型的生成逻辑
 */
import { submitOpenAiChatWithLogs } from './providerKit.js';
import { BaseProvider } from './baseProvider.js';

const VISION_DETAILS = new Set(['auto', 'low', 'high', 'original']);

function visionContent({ prompt, images, detail }) {
    const imageDetail = VISION_DETAILS.has(detail) ? detail : 'auto';
    return [
        { type: 'text', text: prompt || '' },
        ...images.map((url) => ({
            type: 'image_url',
            image_url: { url, detail: imageDetail }
        }))
    ];
}

function redactVisionContent(content) {
    if (!Array.isArray(content)) return content;
    return content.map((item) => item.type === 'image_url'
        ? { ...item, image_url: { ...item.image_url, url: '[Image]' } }
        : item);
}

/**
 * DeepSeek 处理器
 */
export const DeepSeekProvider = {
    /**
     * DeepSeek 文本生成处理器
     */
    async generateText(params, config) {
        // 从环境变量中读取 API Key
        const { DEEPSEEK_API_KEY, LOGS_DIR } = config;
        const { nodeId, prompt, textModel, detail, url: finalUrl } = params;

        if (!DEEPSEEK_API_KEY) throw new Error("DeepSeek API Key 未配置。请在 .env 中设置 DEEPSEEK_API_KEY");

        if (!finalUrl) {
            throw new Error(`[DeepSeek-Provider] 模型 ${textModel} 的端点地址未配置。`);
        }

        const images = BaseProvider.resolveInputImages(params.images || params.imageBase64);
        if (images.length > 0 && textModel === 'deepseek-v4-pro') {
            throw new Error(`DeepSeek 模型 ${textModel} 未声明支持图片输入，请选择 DeepSeek-V4.1-Flash。`);
        }

        const content = images.length > 0
            ? visionContent({ prompt, images, detail })
            : (prompt || '');

        const reasoningEffort = params.reasoning_effort ?? 'high';
        if (!['low', 'high', 'max'].includes(reasoningEffort)) {
            throw new Error('DeepSeek 不支持所选思考强度。');
        }

        // 构建请求体（OpenAI-compatible Chat Completions）。
        const body = {
            model: textModel,
            messages: [
                { role: "user", content }
            ],
            thinking: { type: "enabled" },
            reasoning_effort: reasoningEffort
        };


        const result = await submitOpenAiChatWithLogs({
            url: finalUrl,
            headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
            body,
            signal: params.signal,
            onToken: params.onToken,
            nodeId,
            logsDir: LOGS_DIR,
            modelId: textModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody: {
                ...body,
                messages: [{ role: 'user', content: redactVisionContent(content) }]
            }
        });

        // 获取回复文本
        const text = result.text;
        
        if (!text) {
            throw new Error(`DeepSeek 响应中未包含内容: ${JSON.stringify(result)}`);
        }

        const response = { text };
        
        // 如果有思考过程（DeepSeek-R1 等模型），也一并返回
        if (result.reasoning) {
            response.reasoning = result.reasoning;
        }

        return response;
    }
};
