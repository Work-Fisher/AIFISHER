import { BaseProvider } from './baseProvider.js';
import { submitOpenAiChatWithLogs } from './providerKit.js';

function createOfficialTextProvider({ displayName, secretKey }) {
  return Object.freeze({
    async generateText(params, config = {}) {
      const apiKey = String(config[secretKey] || '').trim();
      const finalUrl = String(params?.url || '').trim();
      const textModel = String(params?.textModel || '').trim();
      if (!apiKey) throw new Error(`${displayName} API Key 未配置。`);
      if (!finalUrl || !textModel) {
        throw new Error(`[${displayName}-Provider] 模型端点未配置。`);
      }

      const images = BaseProvider.resolveInputImages(params.images || params.imageBase64);
      if (images.length && !['glm-5.3-flash', 'kimi-k3'].includes(textModel)) {
        throw new Error(`${displayName} 模型 ${textModel} 不支持图片输入。`);
      }
      const content = images.length
        ? [
          { type: 'text', text: String(params.prompt || '') },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
        : String(params.prompt || '');
      if (textModel === 'kimi-k3' && params.reasoning_effort !== undefined
        && !['low', 'high', 'max'].includes(params.reasoning_effort)) {
        throw new Error('Kimi 不支持所选思考强度。');
      }
      const body = {
        model: textModel,
        ...(textModel === 'kimi-k3' ? { reasoning_effort: params.reasoning_effort ?? 'max' } : {}),
        messages: [{ role: 'user', content }],
        ...(textModel.startsWith('glm-5.3') ? {
          thinking: { type: 'enabled' },
          reasoning_effort: ['low', 'high', 'max'].includes(params.reasoning_effort)
            ? params.reasoning_effort
            : 'max',
        } : {}),
      };
      const result = await submitOpenAiChatWithLogs({
        url: finalUrl,
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
        signal: params.signal,
        onToken: params.onToken,
        nodeId: params.nodeId,
        logsDir: config.LOGS_DIR,
        modelId: textModel,
        projectId: params.projectId,
        useProxy: params.useProxy,
        logBody: body,
      });
      const text = result.text.trim();
      if (!text) throw new Error(`${displayName} 响应中未包含文本内容。`);
      return {
        text,
        ...(result.reasoning
          ? { reasoning: result.reasoning }
          : {}),
      };
    },
  });
}

export const GlmTextProvider = createOfficialTextProvider({
  displayName: 'GLM',
  secretKey: 'ZHIPU_API_KEY',
});

export const KimiTextProvider = createOfficialTextProvider({
  displayName: 'Kimi',
  secretKey: 'MOONSHOT_API_KEY',
});
