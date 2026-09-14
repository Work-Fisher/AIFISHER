import express from 'express';
import { BackgroundError, MAX_BACKGROUND_BYTES } from './backgroundImage.js';

export function createBackgroundRouter(store) {
  const router = express.Router();
  let uploading = false;
  const failed = (response, error) => {
    const known = error instanceof BackgroundError;
    response.status(known ? error.status : 500).json({
      error: known ? error.message : '背景读取或保存失败，请重试。',
      code: known ? error.code : 'BACKGROUND_STORAGE_ERROR',
    });
  };
  const handle = action => async (request, response) => {
    try { await action(request, response); }
    catch (error) { failed(response, error); }
  };
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.get('/', handle(async (_request, response) => response.json(await store.read())));
  router.get('/:id', handle(async (request, response) => {
    response.type('image/webp').send(await store.image(request.params.id));
  }));
  router.post('/', (request, response, next) => {
    if (uploading) return failed(response, new BackgroundError('背景正在处理中，请稍后重试。', 429, 'BACKGROUND_BUSY'));
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(request.headers['content-type']?.split(';')[0].trim().toLowerCase())) {
      return failed(response, new BackgroundError('请选择 JPG、PNG 或静态 WebP 图片。', 415));
    }
    uploading = true;
    let released = false;
    const release = () => { if (!released) { released = true; uploading = false; } };
    response.once('finish', release);
    response.once('close', release);
    next();
  }, express.raw({ type: () => true, limit: MAX_BACKGROUND_BYTES, inflate: false }), handle(async (request, response) => {
    response.json(await store.replace(request.body, request.headers['content-type'].split(';')[0].trim().toLowerCase()));
  }));
  router.delete('/', handle(async (_request, response) => response.json(await store.remove())));
  router.use((error, _request, response, _next) => {
    failed(response, error.type === 'entity.too.large'
      ? new BackgroundError('背景图片不能超过 20 MiB。', 413, 'BACKGROUND_TOO_LARGE')
      : new BackgroundError('图片上传失败，请重新选择图片。', 400, 'BACKGROUND_UPLOAD_FAILED'));
  });
  return router;
}
