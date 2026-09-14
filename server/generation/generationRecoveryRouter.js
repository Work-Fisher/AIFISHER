import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

function taskResponse(task) {
  if (!task) return null;
  if (task.status === 'loading' || task.status === 'queued') {
    return { status: 'pending', attemptId: task.attemptId };
  }
  const diagnostics = {
    attemptId: task.attemptId,
    providerName: task.providerName,
    estimatedCost: task.estimatedCost,
    durationMs: task.durationMs,
    diagnosticCode: task.diagnosticCode || task.code,
  };
  if (task.status === 'success') {
    return {
      status: 'success',
      type: task.type || task.kind,
      resultUrl: task.resultUrl,
      resultUrls: task.resultUrls,
      text: task.text,
      createdAt: task.createdAt,
      model: task.model || task.modelName,
      ...diagnostics,
    };
  }
  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'unknown') {
    return {
      status: task.status,
      code: task.code,
      error: task.error,
      retryable: Boolean(task.retryable),
      ...(task.recoveryPending ? { recoveryPending: true } : {}),
      ...(task.code === 'GENERATION_PARTIAL_RESULTS' ? {
        type: task.kind, resultUrl: task.resultUrl, resultUrls: task.resultUrls,
      } : {}),
      ...diagnostics,
    };
  }
  return null;
}

function findLatestMediaResult({ mediaDir, nodeId, getUrlPrefix }) {
  if (!fs.existsSync(mediaDir)) return null;
  let latestResult = null;
  for (const projectId of fs.readdirSync(mediaDir)) {
    for (const type of ['images', 'videos', 'audios']) {
      const typeDir = path.join(mediaDir, projectId, type);
      if (!fs.existsSync(typeDir)) continue;
      const files = fs.readdirSync(typeDir).filter((file) => file.endsWith('.json'));
      for (const file of files) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(typeDir, file), 'utf8'));
          if (meta.nodeId !== nodeId) continue;
          if (!latestResult || new Date(meta.createdAt) > new Date(latestResult.createdAt)) {
            latestResult = {
              status: 'success',
              resultUrl: `${getUrlPrefix()}/media/${projectId}/${type}/${meta.filename}`,
              type: type === 'images' ? 'image' : type === 'videos' ? 'video' : 'audio',
              createdAt: meta.createdAt,
              aspectRatio: meta.aspectRatio,
              resolution: meta.resolution,
              model: meta.model,
              prompt: meta.prompt,
              cost: meta.cost,
            };
          }
        } catch {
          // A malformed legacy metadata file must not prevent recovery of other assets.
        }
      }
    }
  }
  return latestResult;
}

export function createGenerationRecoveryRouter({ coordinator, getUrlPrefix, recoverTask }) {
  if (!coordinator || typeof coordinator.getTask !== 'function') {
    throw new Error('Generation recovery router requires a coordinator');
  }
  const router = express.Router();

  router.post('/generation-cancel/:nodeId', (req, res) => {
    // Agent cancellation binds to the observed attempt. A stale UI must never cancel a newer task.
    if (req.body?.attemptId !== undefined || req.body?.projectId !== undefined) {
      const task = coordinator.getTask(req.params.nodeId);
      if (!task || !req.body.attemptId || task.attemptId !== req.body.attemptId || task.projectId !== req.body.projectId)
        return res.status(409).json({ code: 'GENERATION_ATTEMPT_CONFLICT', status: 'unknown' });
    }
    const result = coordinator.cancel(req.params.nodeId);
    if (!result.ok) {
      return res.status(409).json({
        error: '该生成任务当前不可取消。',
        code: result.code,
        status: result.task?.status || 'missing',
      });
    }
    return res.json({
      success: true,
      status: 'cancelled',
      code: result.task.code,
      retryable: result.task.retryable,
      remoteMayContinue: result.task.remoteMayContinue !== false,
    });
  });

  router.get('/generation-status/:nodeId', async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestedAttemptId = String(req.query.attemptId || '').trim();
      let persistedTask = coordinator.getTask(nodeId);
      if (requestedAttemptId && persistedTask?.attemptId !== requestedAttemptId) {
        // A media file alone cannot prove the whole attempt completed (e.g. a partial batch).
        return res.json({ status: 'missing', attemptId: requestedAttemptId });
      }
      if (persistedTask && recoverTask) {
        persistedTask = await recoverTask(persistedTask, req.app.locals);
        if (requestedAttemptId && persistedTask?.attemptId !== requestedAttemptId) {
          return res.json({ status: 'missing', attemptId: requestedAttemptId });
        }
      }
      const persistedTaskResponse = taskResponse(persistedTask);
      if (persistedTaskResponse) return res.json(persistedTaskResponse);
      if (requestedAttemptId) return res.json({ status: 'missing', attemptId: requestedAttemptId });

      const libraryDir = req.app.locals.LIBRARY_DIR || path.join(process.cwd(), 'library');
      const latestMedia = findLatestMediaResult({
        mediaDir: path.join(libraryDir, 'media'),
        nodeId,
        getUrlPrefix,
      });
      if (latestMedia) return res.json(latestMedia);

      const cachedText = req.app.locals.textResultCache?.get(nodeId);
      if (cachedText) {
        return res.json({
          status: 'success',
          type: 'text',
          text: cachedText.text,
          createdAt: cachedText.createdAt,
          model: cachedText.model,
        });
      }
      return res.json({ status: 'missing' });
    } catch (error) {
      console.error('Generation status recovery failed:', error);
      return res.status(500).json({
        error: '读取生成状态失败。',
        code: 'GENERATION_STATUS_READ_FAILED',
      });
    }
  });

  return router;
}
