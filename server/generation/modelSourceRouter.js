/**
 * modelSourceRouter.js
 *
 * 设置页要按「站」分块渲染（AIFISHER API / RunningHub / 厂商直连），
 * 而站与模型的对应关系只存在于后端目录里——前端硬编一份必然漂移。
 *
 * 这里只回答「有哪些站、每站有哪些模型、每个密钥填没填」。
 * 密钥本身永远不出后端：secrets 里只有 key 名和一个布尔值。
 */

import express from 'express';
import { buildModelAvailability, buildSourceSettings } from './modelAvailability.js';
import { createRelayPricingClient } from './relayPricing.js';

export function createModelSourceRouter({
  catalog,
  readSecret = (key) => process.env[key],
  logger = console,
  relayPricingClient = createRelayPricingClient({ logger }),
  getProviderConfiguration = async () => ({}),
} = {}) {
  const router = express.Router();

  router.get('/generation/sources', async (request, response) => {
    try {
      const providerConfiguration = await getProviderConfiguration(request);
      response.json({ blocks: buildSourceSettings({
        catalog,
        readSecret,
        providerConfiguration,
      }) });
    } catch (error) {
      logger.error('[ModelSource] 读取生成来源失败：', error?.message || error);
      response.status(500).json({ error: '读取生成来源失败。' });
    }
  });

  /**
   * 画布模型下拉用的切法：一级 canonicalModel、二级来源。
   * 与设置页相反——在画布上用户已经知道要哪个模型，只需要决定从哪买。
   * resolution 和 mode 必须带上：视频参考、视频编辑等模式本来就不是同一个价，
   * 只按分辨率比会把 Kling O3 的文生价错套到视频编辑。
   */
  router.get('/generation/model-availability', async (request, response) => {
    try {
      const resolution = typeof request.query.resolution === 'string' ? request.query.resolution : null;
      const mode = typeof request.query.mode === 'string' ? request.query.mode : null;
      const aspectRatio = typeof request.query.aspectRatio === 'string'
        ? request.query.aspectRatio : null;
      const parsedDuration = Number(request.query.duration);
      const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 && parsedDuration <= 300
        ? parsedDuration : null;
      const requestedSpeed = typeof request.query.speed === 'string'
        ? request.query.speed.toLowerCase() : null;
      const speed = ['relax', 'fast', 'turbo'].includes(requestedSpeed)
        ? requestedSpeed : null;
      const requestedGenerateAudio = typeof request.query.generateAudio === 'string'
        ? request.query.generateAudio.toLowerCase() : null;
      const generateAudio = requestedGenerateAudio === 'true'
        ? true
        : requestedGenerateAudio === 'false'
        ? false
        : null;
      const parsedInputImageCount = Number(request.query.inputImageCount);
      const inputImageCount = Number.isInteger(parsedInputImageCount)
        && parsedInputImageCount >= 0
        && parsedInputImageCount <= 100
        ? parsedInputImageCount
        : null;
      let relayPricing = null;
      const providerConfiguration = await getProviderConfiguration(request, { waitForFresh: false });
      try {
        relayPricing = await relayPricingClient.getSnapshot({ waitForFresh: false });
      } catch (error) {
        // 价格服务失效不该让整个模型下拉 500。下游会保留画布基准价，
        // 同时明确标注“实时估价暂不可用”和“最终以任务账单为准”。
        logger.warn?.('[ModelSource] 读取中转站实时价格失败：', error?.message || error);
      }
      // This response contains per-user key availability. Never cache an old
      // unconfigured result after a provider key is saved.
      response.set('Cache-Control', 'no-store');
      response.json({ groups: buildModelAvailability({
        catalog,
        readSecret,
        resolution,
        mode,
        aspectRatio,
        duration,
        speed,
        generateAudio,
        inputImageCount,
        relayPricing,
        providerConfiguration,
      }) });
    } catch (error) {
      logger.error('[ModelSource] 读取模型可用性失败：', error?.message || error);
      response.status(500).json({ error: '读取模型可用性失败。' });
    }
  });

  return router;
}
