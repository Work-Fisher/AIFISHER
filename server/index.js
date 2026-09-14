import { createLibTvCliRuntime, createLibTvCliRouter } from './local/libTvCliRuntime.js';
// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
import { RUNTIME_PATHS } from './workspace/runtimePaths.js';
import configRoutes, { USER_PROVIDER_SECRET_KEYS } from './routes/config.js';
if (RUNTIME_PATHS.ACTIVE_OPAQUE_USER_ID) {
    const protectedProviderValues = Object.fromEntries(
        USER_PROVIDER_SECRET_KEYS
            .filter((key) => process.env[key])
            .map((key) => [key, process.env[key]])
    );
    for (const key of USER_PROVIDER_SECRET_KEYS) delete process.env[key];
    dotenv.config({ path: RUNTIME_PATHS.ENV_PATH, override: true });
    Object.assign(process.env, protectedProviderValues);
}

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    createLocalRuntimeLifecycle,
    describeListenTarget,
    resolveListenTarget
} from './runtime/localRuntimeLifecycle.js';
import { createParentChannel } from './runtime/parentChannel.js';
import { installBackendLifecycleDiagnostics } from './runtime/backendLifecycleDiagnostics.js';
import { serveCanvas } from './runtime/serveCanvas.js';
import { isBundledFFmpegAvailable } from './diagnostics/ffmpegProbe.js';

import { createGenerationRouter } from './routes/generation.js';
import { createModelSourceRouter } from './generation/modelSourceRouter.js';
import { createGenerationRuntime } from './generation/generationRuntime.js';
import { comfyClient } from './comfyui/comfyClient.js';
import { WORKFLOW_REGISTRY } from './comfyui/workflowRegistry.js';
import { createComfyWorkflowRouter } from './comfyui/comfyWorkflowRouter.js';
import { createLegacyComfyGenerationRouter } from './comfyui/legacyComfyGenerationRouter.js';
import { saveAssetMetadata, generateAssetId, resolveLocalPath } from './utils/imageHelpers.js';
import { BaseProvider } from './providers/baseProvider.js';
import { workflowStore } from './workflow/sqliteWorkflowStore.js';
import { createWorkflowRouter } from './workflow/workflowRouter.js';
import { createWorkflowSnapshotWriter } from './workflow/workflowSnapshot.js';
import { createFolderRouter } from './project/folderRouter.js';
import { createProjectTransferRouter } from './project/projectTransferRouter.js';
import { createPromptPresetRouter } from './prompt/promptPresetRouter.js';
import { createPromptAssistantRouter } from './prompt/promptAssistantRouter.js';
import { createAgentRouter } from './agent/agentRouter.js';
import { createCodexService } from './agent/codex/codexService.js';
import { createCanvasExternalService } from './agent/codex/canvasExternalService.js';
import { createAgentWorkspaceStore, createAgentWorkspaceRouter } from './agent/agentWorkspaceStore.js';
import { createCodexRouter } from './agent/codex/codexRouter.js';
import { createGenerationPlanStore, createGenerationPlanRouter } from './agent/codex/generationPlanStore.js';
import { createGenerationBudgetStore, createGenerationBudgetRouter } from './agent/codex/generationBudgetStore.js';
import { createAgentSkillLibrary } from './agent/agentSkillLibrary.js';
import { createAgentSkillRouter } from './agent/agentSkillRouter.js';
import { createDramaPlanStore } from './agent/drama/dramaPlanStore.js';
import { createDramaPlanRouter } from './agent/drama/dramaPlanRouter.js';
import { createDramaExecutionService } from './agent/drama/dramaExecutionService.js';
import { createDramaModelGenerator } from './agent/drama/dramaModelGenerator.js';
import { compileDramaSegment } from './agent/drama/dramaPlan.js';
import { createDramaScriptImportRouter } from './agent/drama/dramaScriptImport.js';
import { createStoryboardRouter } from './storyboard/storyboardRouter.js';
import { createLocalRuntimeRouter } from './local/localRuntimeRouter.js';
import { probeComfyReady, probeComfyServer, probeNvidiaGpu } from './local/localRuntimeProbes.js';
import { createComfyProcessController } from './local/comfyProcess.js';
import controllerExitGuard from './local/controllerExitGuard.cjs';
import { createComfyExtensionInstaller } from './local/comfyExtensionInstaller.js';
import { createDreaminaCliInstaller } from './local/dreaminaCliInstaller.js';
import { createRequestContextMiddleware, installSecureConsole } from './security/requestContext.js';
import { createModelCallReporter } from './telemetry/modelCallReporter.js';
import { createPreferenceRouter, createPreferenceStore } from './preferences/preferenceStore.js';
import { createBackgroundRouter } from './appearance/backgroundRouter.js';
import { createBackgroundStore } from './appearance/backgroundStore.js';
import { inspectLocalAuthenticationConfiguration } from './security/localAuthenticationRuntime.js';
import {
    attachActiveUserContext,
    createActiveUserContext,
    createExactLocalBoundary,
    getAuthenticatedRequest
} from './security/localAuthentication.js';
import { createPublicLibraryGuard } from './security/publicLibraryGuard.js';
import { createSafeProxyRouter } from './security/safeProxyRouter.js';
import { createIdentityAccountRouter } from './account/identityAccountRouter.js';
import { createRelayAccountAdapter } from './account/relayAccountAdapter.js';
import { createRelayAccountRouter } from './account/relayAccountRouter.js';
import { RelayAccountService } from './account/relayAccountService.js';
import { RelayAccountStore } from './account/relayAccountStore.js';
import { createDiagnosticsRouter } from './diagnostics/diagnosticsRouter.js';
import { createThumbnailCache, ThumbnailCacheError } from './media/thumbnailCache.js';
import { createMediaAssetRouter } from './media/mediaAssetRouter.js';
import { createMediaEditingRouter } from './media/mediaEditingRouter.js';
import { createMediaDownloadRouter } from './media/mediaDownloadRouter.js';
import { createLegacyLibraryRouter } from './media/legacyLibraryRouter.js';
import { createTosRouter } from './storage/tosRouter.js';
import { denyPrivateLibraryPath } from './workflowRuntime/privateLibraryGuard.js';
import { createExecutionWorkflowRuntime } from './workflowRuntime/executionWorkflowRuntime.js';
import {
    BASE_LIBRARY_DIR,
    getWorkspacePaths,
    getUrlPrefix
} from './workspace/workspacePaths.js';

export { getWorkspacePaths, getUrlPrefix } from './workspace/workspacePaths.js';

installSecureConsole();

// Desktop mode listens only on the named pipe given by the Electron main process; there is
// then no TCP port, no Origin boundary and no port in diagnostics.
const LISTEN_TARGET = resolveListenTarget();
const PORT = LISTEN_TARGET.path ? null : LISTEN_TARGET.port;
const PRODUCT_VERSION =
    process.env.AIFISHER_PRODUCT_VERSION || process.env.npm_package_version || '0.0.0-dev';
const RUNTIME_INSTANCE_TOKEN = String(
    process.argv.find((value) => value.startsWith('--fisherai-instance='))
        ?.slice('--fisherai-instance='.length) || ''
);
const RUNTIME_INSTANCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const parentChannel = createParentChannel();
const authenticationConfiguration = inspectLocalAuthenticationConfiguration({
    runtimePaths: RUNTIME_PATHS,
    port: PORT
});

function runtimeInstanceMatches(candidate) {
    if (
        !RUNTIME_INSTANCE_PATTERN.test(RUNTIME_INSTANCE_TOKEN) ||
        !RUNTIME_INSTANCE_PATTERN.test(String(candidate || ''))
    ) return false;
    const expected = crypto.createHash('sha256').update(RUNTIME_INSTANCE_TOKEN).digest();
    const received = crypto.createHash('sha256').update(String(candidate)).digest();
    return crypto.timingSafeEqual(expected, received);
}

function handleRuntimeShutdownRequest(request, response, shutdown) {
    if (
        request.method !== 'POST' ||
        request.originalUrl !== '/internal/runtime/shutdown' ||
        request.headers.origin !== undefined ||
        !LOOPBACK_ADDRESSES.has(String(request.socket?.remoteAddress || '').toLowerCase()) ||
        !runtimeInstanceMatches(request.headers['x-aifisher-runtime-instance'])
    ) {
        response.status(401).json({ error: 'Unauthorized', code: 'RUNTIME_SHUTDOWN_UNAUTHORIZED' });
        return;
    }
    response.once('finish', () => setImmediate(() => void shutdown()));
    response.setHeader('Cache-Control', 'no-store');
    response.status(202).json({ ok: true });
}

function launchRuntime(runtime, description) {
    const diagnostics = installBackendLifecycleDiagnostics({ logsDirectory: RUNTIME_PATHS.LOGS_DIR });
    let shutdownPromise;
    let exitCode = 0;
    const stopControllerGuard = controllerExitGuard.startControllerExitGuard({
        onControllerExit: () => void shutdown(0, 'controller-exited'),
    });
    function shutdown(code = 0, reason = 'internal-request') {
        exitCode = Math.max(exitCode, code);
        if (shutdownPromise) return shutdownPromise;
        diagnostics.shutdownRequested(reason);
        stopControllerGuard?.();
        shutdownPromise = runtime.stop().catch((error) => {
            console.error('本机服务关闭失败:', error);
            exitCode = 1;
        }).then(() => process.exit(exitCode));
        return shutdownPromise;
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown(0, signal));
    // The Electron main process asks for a stop so SQLite and owned ComfyUI close before exit.
    parentChannel.onStop(() => void shutdown(0, 'desktop-stop'));
    void runtime.start().then((started) => {
        if (!started) return;
        console.log(description);
        parentChannel.notifyReady();
    }).catch((error) => {
        console.error('初始化本机服务失败:', error);
        return shutdown(1, 'startup-failed');
    });
    return shutdown;
}

function startLockedServer() {
    const lockedApp = express();
    lockedApp.post('/internal/runtime/shutdown', (request, response) => {
        handleRuntimeShutdownRequest(request, response, shutdown);
    });
    if (PORT !== null) {
        lockedApp.use(createExactLocalBoundary({
            trustedOrigins: [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]
        }));
    }
    lockedApp.get('/healthz', (_request, response) => response.json({
        ok: true,
        service: 'aifisher-canvas',
        version: PRODUCT_VERSION
    }));
    lockedApp.get('/readyz', (_request, response) => response.status(503).json({
        ok: false,
        ready: false,
        service: 'aifisher-collab',
        version: PRODUCT_VERSION,
        authentication: 'locked',
        code: 'COLLABORATION_AUTHENTICATION_LOCKED'
    }));
    lockedApp.use(['/api', '/library', '/diagnostics'], (_request, response) => {
        response.status(401).json({
            error: '需要登录后访问',
            code: 'AUTHENTICATION_REQUIRED'
        });
    });
    if (process.env.NODE_ENV === 'production') {
        serveCanvas(lockedApp, RUNTIME_PATHS.DIST_DIR);
    }
    const runtime = createLocalRuntimeLifecycle({ app: lockedApp, listen: LISTEN_TARGET });
    const shutdown = launchRuntime(runtime,
        `Backend server locked on ${describeListenTarget(LISTEN_TARGET)} (authentication required)`);
}

if (!authenticationConfiguration.ready) {
    startLockedServer();
} else {

// Error handling for unhandled promises and exceptions
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
});

const app = express();
// The main process starts this backend for one signed-in user and restarts it on an account
// change, so the user, the directories and the token source are fixed for its lifetime.
const activeUserContext = createActiveUserContext({
    activeOpaqueUserId: authenticationConfiguration.activeOpaqueUserId,
    userScopeResolver: authenticationConfiguration.userScopeResolver,
    getAccessToken: () => parentChannel.requestAccessToken()
});
const { identityProfileClient, identityAccountClient } = authenticationConfiguration;
if (!identityAccountClient) {
    console.log('[Identity] 未配置 Identity 地址：账号资料、意见反馈与调用遥测暂不可用');
}
const modelCallReporter = identityAccountClient ? createModelCallReporter({
    identityAccountClient,
    getAccessToken: activeUserContext.getAccessToken,
    clientVersion: PRODUCT_VERSION
}) : null;
const canvasExternalService = createCanvasExternalService({ onRevokeSession: (projectId, sessionId) => app.locals.GENERATION_BUDGETS?.revokeSession(projectId, sessionId) });

const LOGS_DIR = RUNTIME_PATHS.LOGS_DIR;
const thumbnailCache = createThumbnailCache({ libraryDir: BASE_LIBRARY_DIR });
async function serveMediaThumbnail(request, response) {
    try {
        const thumbnailPath = await thumbnailCache.get(request.query.url, request.query.max);
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.type('image/webp');
        response.sendFile(thumbnailPath, { dotfiles: 'allow' });
    } catch (error) {
        const status = error instanceof ThumbnailCacheError ? error.status : 500;
        if (status >= 500) console.error('Thumbnail generation error:', error);
        response.status(status).json({ error: error.message || '缩略图生成失败' });
    }
}
const agentSkillLibrary = createAgentSkillLibrary({ libraryDirectory: BASE_LIBRARY_DIR });
const writeProjectJsonSnapshot = createWorkflowSnapshotWriter({
    mediaDirectory: path.join(BASE_LIBRARY_DIR, 'media')
});

// Map path constants to global object for backward compatibility across the file
Object.defineProperties(global, {
    WORKFLOWS_DIR: { get: () => getWorkspacePaths().WORKFLOWS_DIR },
    FOLDERS_JSON_PATH: { get: () => getWorkspacePaths().FOLDERS_JSON_PATH }
});

// Initial directories check
[BASE_LIBRARY_DIR, path.join(BASE_LIBRARY_DIR, 'media'), path.join(BASE_LIBRARY_DIR, 'assets'), LOGS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const relayAccountStore = new RelayAccountStore({
    privateDirectory: RUNTIME_PATHS.PRIVATE_DIR,
    opaqueUserId: RUNTIME_PATHS.ACTIVE_OPAQUE_USER_ID
});
const relayAccountBaseUrl = process.env.RELAY_BASE_URL
    || 'https://api.work-fisher.com';
const relayAccountService = new RelayAccountService({
    store: relayAccountStore,
    adapter: createRelayAccountAdapter({
        apiKey: () => process.env.RELAY_API_KEY,
        baseUrl: relayAccountBaseUrl,
        allowedOrigins: [new URL(relayAccountBaseUrl).origin]
    })
});
relayAccountService.initialize();

const generationRuntime = createGenerationRuntime({
    libraryDirectory: BASE_LIBRARY_DIR,
    parseTimeToMs: (timeEstimate) => BaseProvider.parseTimeToMs(timeEstimate),
    onTaskChange: (task) => relayAccountService.observeGenerationTask(task)
});
const executionWorkflowRuntime = await createExecutionWorkflowRuntime({
    libraryDirectory: BASE_LIBRARY_DIR,
    privateDirectory: RUNTIME_PATHS.PRIVATE_DIR,
    generationRuntime
});

function getDiagnosticsProviderStatus() {
    const configured = (...keys) => keys.every((key) => Boolean(process.env[key]?.trim()));
    return {
        OpenAI: { configured: configured('OPENAI_API_KEY') },
        DeepSeek: { configured: configured('DEEPSEEK_API_KEY') },
        GLM: { configured: configured('ZHIPU_API_KEY') },
        Kimi: { configured: configured('MOONSHOT_API_KEY') },
        Ark: { configured: configured('ARK_API_KEY') },
        Grok: { configured: configured('GROK_API_KEY') },
        Aliyun: { configured: configured('ALIYUN_API_KEY') },
        Mureka: { configured: configured('MUREKA_API_KEY') },
        RunningHub: { configured: configured('RUNNINGHUB_API_KEY') },
        Fal: { configured: configured('FAL_API_KEY') },
        Jimeng: { configured: configured('JIMENG_ACCESS_KEY', 'JIMENG_SECRET_KEY') },
        Kling: { configured: configured('KLING_ACCESS_KEY', 'KLING_SECRET_KEY') },
        TOS: { configured: configured('TOS_ACCESS_KEY', 'TOS_SECRET_KEY') }
    };
}

async function readLogTail(filePath, maxBytes = 64 * 1024) {
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const { size } = await handle.stat();
        const length = Math.min(size, maxBytes);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, Math.max(0, size - length));
        return buffer.toString('utf8');
    } finally {
        await handle.close();
    }
}

async function readRecentDiagnosticLogs() {
    const entries = await fs.promises.readdir(LOGS_DIR, { withFileTypes: true });
    const candidates = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
        .map(async (entry) => {
            const filePath = path.join(LOGS_DIR, entry.name);
            return { filePath, modifiedAt: (await fs.promises.stat(filePath)).mtimeMs };
        }));
    const texts = await Promise.all(candidates
        .sort((left, right) => right.modifiedAt - left.modifiedAt)
        .slice(0, 3)
        .map((entry) => readLogTail(entry.filePath)));
    return texts
        .flatMap((text) => text.split(/\r?\n/))
        .filter(Boolean)
        .slice(-200);
}

// Every request that reaches this backend is the active user's: the named pipe is reachable
// only through the desktop main process, and loopback TCP keeps other web pages out below.
app.post('/internal/runtime/shutdown', (request, response) => {
    handleRuntimeShutdownRequest(request, response, shutdown);
});
if (PORT !== null) {
    app.use(createExactLocalBoundary({
        trustedOrigins: authenticationConfiguration.trustedOrigins
    }));
}
app.get('/healthz', (_request, response) => response.json({
    ok: true,
    service: 'aifisher-canvas',
    version: PRODUCT_VERSION
}));
app.get('/readyz', (_request, response) => {
    // Ready once the backend listens; the response shape stays what runtime control reads.
    const ready = runtime.ready;
    response.status(ready ? 200 : 503).json({
        ok: ready,
        ready,
        service: 'aifisher-collab',
        version: PRODUCT_VERSION,
        authentication: ready ? 'ready' : 'locked',
        ...(ready ? {} : { code: 'COLLABORATION_AUTHENTICATION_LOCKED' })
    });
});
app.use(createRequestContextMiddleware());
app.use(['/api', '/library', '/diagnostics'], attachActiveUserContext(activeUserContext));
app.get('/api/media/thumbnail', serveMediaThumbnail);
app.use(createIdentityAccountRouter({ identityProfileClient, identityAccountClient }));
app.use(createRelayAccountRouter({ service: relayAccountService }));
// Workflow import and test configuration have stricter route-level body limits.
// They must be mounted before the legacy 200 MiB parser so those limits apply
// before any large request is buffered in memory.
app.use(executionWorkflowRuntime.router);
app.use(createAgentSkillRouter({ skillLibrary: agentSkillLibrary }));
const getAgentCredentials = () => ({
    ARK_API_KEY: process.env.ARK_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    ZHIPU_API_KEY: process.env.ZHIPU_API_KEY,
    MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
    RELAY_API_KEY: process.env.RELAY_API_KEY,
    LOGS_DIR
});
const dramaPlanStore = createDramaPlanStore({ libraryDirectory: getWorkspacePaths().LIBRARY_DIR });
const dramaExecutionService = createDramaExecutionService({
    planStore: dramaPlanStore,
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR,
    executionDirectory: path.join(RUNTIME_PATHS.PRIVATE_DIR, 'agent-drama-executions'),
    ...executionWorkflowRuntime.services,
    generationCoordinator: generationRuntime.coordinator,
    compileSegment: compileDramaSegment,
    appContext: app.locals
});
// Auth/CSRF above apply to every route. Keep upload and plan limits before the legacy parser.
app.use(createDramaScriptImportRouter());
app.use('/api/agent/drama', createDramaPlanRouter({
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR,
    store: dramaPlanStore,
    generatePlan: createDramaModelGenerator({ getCredentials: getAgentCredentials, telemetryReporter: modelCallReporter }),
    executionService: dramaExecutionService
}));
// Agent payload size follows the selected provider; other product routes keep their parser.
app.use(['/api/chat', '/api/agent'], express.json({ limit: Infinity }));
app.use(express.json({ limit: '200mb' }));
app.use('/api/media-download', createMediaDownloadRouter());
app.use('/api', createSafeProxyRouter());
app.use(createDiagnosticsRouter({
    version: PRODUCT_VERSION,
    getPorts: () => ({
        backend: PORT
    }),
    checkFfmpeg: async () => ({
        status: await isBundledFFmpegAvailable(RUNTIME_PATHS.BIN_DIR) ? 'ready' : 'missing'
    }),
    checkDatabase: async () => ({
        status: 'ready',
        schemaVersion: await workflowStore.getSchemaVersion()
    }),
    checkDirectory: async () => {
        await fs.promises.access(BASE_LIBRARY_DIR, fs.constants.R_OK | fs.constants.W_OK);
        return { status: 'ready', writable: true };
    },
    getProviderStatus: getDiagnosticsProviderStatus,
    readRecentLogs: readRecentDiagnosticLogs
}));

const comfyProcessController = createComfyProcessController({
    // 就绪判定只看 /system_stats：ComfyUI 刚起来时 /object_info 要 6 秒、5.7MB，
    // 拿它判存活会把「已就绪」误判成「未运行」。
    probeComfy: (serverUrl) => probeComfyReady(serverUrl)
});

const comfyExtensionInstaller = createComfyExtensionInstaller({
    sourceDirectory: path.join(RUNTIME_PATHS.INTEGRATIONS_DIR, 'comfyui', 'fisherai_node_ids'),
    detectInstallation: () => comfyProcessController.detect(),
    getProcessState: () => comfyProcessController.getState()
});

const dreaminaCliInstaller = createDreaminaCliInstaller({
    // CLI 和 OAuth 状态都跟随服务端选定的 opaque user id，不能落到共享 app/ 或全局 HOME。
    installRoot: path.join(RUNTIME_PATHS.PRIVATE_DIR, 'tools', 'dreamina-cli')
});
// 生成 Provider 只拿到这一个受控运行器：可执行文件路径、OAuth HOME、临时目录和
// 子进程边界仍由 installer 封装，不允许前端传路径或命令。
app.locals.DREAMINA_CLI = dreaminaCliInstaller;
const libTvCli = createLibTvCliRuntime({ privateDirectory: path.join(RUNTIME_PATHS.PRIVATE_DIR, 'tools', 'libtv-cli') });
app.locals.LIBTV_CLI = libTvCli;
app.use('/api/local-runtime/libtv-cli', createLibTvCliRouter(libTvCli));

app.use('/api', createLocalRuntimeRouter({
    modelsDirectory: process.env.LOCAL_MODELS_DIR || RUNTIME_PATHS.MODELS_DIR,
    workflowRegistry: WORKFLOW_REGISTRY,
    getComfyServerUrl: () => process.env.COMFYUI_SERVER_URL || '127.0.0.1:8188',
    probeGpu: () => probeNvidiaGpu(),
    probeComfy: (serverUrl) => probeComfyServer(serverUrl),
    comfyProcess: comfyProcessController,
    comfyExtensionInstaller,
    dreaminaCliInstaller
}));

const codexService = createCodexService({ privateDirectory: RUNTIME_PATHS.PRIVATE_DIR, skillLibrary: agentSkillLibrary });
app.use('/api/agent/workspace', createAgentWorkspaceRouter(createAgentWorkspaceStore(RUNTIME_PATHS.PRIVATE_DIR)));
app.use('/api/preferences', createPreferenceRouter(createPreferenceStore(RUNTIME_PATHS.PRIVATE_DIR)));
app.use('/api/appearance/background', createBackgroundRouter(createBackgroundStore(RUNTIME_PATHS.PRIVATE_DIR)));
app.use('/api/agent/codex', createCodexRouter(codexService));
app.use('/api/agent/external', canvasExternalService.router);
const generationPlans = createGenerationPlanStore(RUNTIME_PATHS.PRIVATE_DIR);
app.use('/api/agent/plans', createGenerationPlanRouter(generationPlans));
app.locals.GENERATION_BUDGETS = createGenerationBudgetStore(RUNTIME_PATHS.PRIVATE_DIR, {
    isSessionActive: sessionId => canvasExternalService.isSessionActive(sessionId),
    getSourceFingerprint: () => crypto.createHash('sha256').update(JSON.stringify(
        [...new Set([...USER_PROVIDER_SECRET_KEYS, ...Object.keys(process.env).filter(key => /(?:_BASE_URL|^RUNNINGHUB_|^TOS_)/.test(key))])].sort().map(key => [key, process.env[key] || ''])
    )).digest('hex')
});
app.use('/api/agent/budgets', createGenerationBudgetRouter(app.locals.GENERATION_BUDGETS));

app.use(createAgentRouter({
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR,
    skillLibrary: agentSkillLibrary,
    telemetryReporter: modelCallReporter,
    dramaPlanStore,
    dramaExecutionService,
    getCredentials: getAgentCredentials
}));

app.use(createPromptAssistantRouter({
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR,
    getApiKey: () => process.env.ZHIPU_API_KEY,
    model: process.env.GLM_PROMPT_MODEL || 'glm-5.3-flash',
    logsDirectory: LOGS_DIR,
    telemetryReporter: modelCallReporter
}));

app.use('/api/storyboard', createStoryboardRouter({
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR,
    logsDirectory: LOGS_DIR,
    getCredentials: () => ({
        arkApiKey: process.env.ARK_API_KEY
    }),
    textModel: process.env.STORYBOARD_TEXT_MODEL || 'doubao-seed-2-0-mini-260428',
    imageModel: process.env.STORYBOARD_IMAGE_MODEL || 'doubao-seedream-5-0-260128',
    telemetryReporter: modelCallReporter
}));

// Prompt presets must precede the static library so a missing prompt.json can
// be initialized through the stable public URL instead of returning 404.
app.use(createPromptPresetRouter({
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR
}));

// Serve static assets from the local library.
app.use('/library', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
}, createPublicLibraryGuard(), denyPrivateLibraryPath, express.static(BASE_LIBRARY_DIR));

// Set up app.locals for sharing config with route modules
app.locals.LOGS_DIR = LOGS_DIR;
for (const key of USER_PROVIDER_SECRET_KEYS) {
    Object.defineProperty(app.locals, key, { get: () => process.env[key] });
}
app.locals.RELAY_BASE_URL = relayAccountBaseUrl;
app.locals.relayAccountActivity = Object.freeze({
  submitted: (task) => relayAccountService.observeUpstreamTask(task),
  settled: (receipt) => relayAccountService.applyFinalReceipt(receipt),
});
app.locals.TOS_BUCKET = process.env.TOS_BUCKET;
app.locals.TOS_ENDPOINT = process.env.TOS_ENDPOINT;
app.locals.TOS_REGION = process.env.TOS_REGION;
app.locals.HTTPS_PROXY = process.env.HTTPS_PROXY;

Object.defineProperty(app.locals, 'LIBRARY_DIR', { get: () => getWorkspacePaths().LIBRARY_DIR });
Object.defineProperty(app.locals, 'LIBRARY_MEDIA_DIR', { get: () => getWorkspacePaths().LIBRARY_MEDIA_DIR });

// Maintainable media source Module. It is mounted before the compressed legacy
// routes and keeps their public API shape for the stable AIFISHER Canvas UI.
app.use('/api', createMediaAssetRouter({
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR,
    workflowStore
}));
app.use('/api', createMediaEditingRouter({
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR
}));
app.use('/api', createComfyWorkflowRouter({
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR,
    workflowRegistry: WORKFLOW_REGISTRY,
    comfyClient,
    telemetryReporter: modelCallReporter,
  }));
// ============================================================================
// MEDIA STORAGE HELPERS
// ============================================================================

/**
 * Ensures project-specific media directories exist.
 * Structure: library/media/{projectId}/{images|videos|audios}
 * @param {string} projectId - ID of the project
 * @param {string} type - 'images', 'videos', or 'audios'
 * @returns {string} - Absolute path to the directory
 */
function getProjectMediaDir(projectId, type) {
    const finalProjectId = projectId || 'default';
    const dir = path.join(getWorkspacePaths().LIBRARY_MEDIA_DIR, finalProjectId, type);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Saves base64 data to project-specific media folder.
 */
function saveMediaToFile(dataUrl, projectId, prompt = '', nodeId = null) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return null;
    }

    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;

    const mimeType = matches[1];
    const base64Data = matches[2];

    try {
        const buffer = Buffer.from(base64Data, 'base64');
        // Generate a unique ID (timestamped if nodeId is provided)
        const id = generateAssetId(nodeId);

        let filename, mediaType;

        if (mimeType.startsWith('video/')) {
            filename = `${id}.mp4`;
            mediaType = 'videos';
        } else if (mimeType.startsWith('audio/')) {
            filename = `${id}.mp3`;
            mediaType = 'audios';
        } else {
            const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
            filename = `${id}.${ext}`;
            mediaType = 'images';
        }

        const finalProjectId = projectId || 'default';
        const targetDir = getProjectMediaDir(finalProjectId, mediaType);
        fs.writeFileSync(path.join(targetDir, filename), buffer);

        // Save metadata using the SAME unique ID to prevent overwriting
        saveAssetMetadata(targetDir, {
            id, // Use unique ID for the .json file
            filename,
            nodeId: nodeId, // Original nodeId for linkage
            prompt: prompt || '',
            type: mediaType,
            model: 'System',
            cost: 0 // System saves (uploads/text) have 0 cost
        });

        const url = `${getUrlPrefix()}/media/${finalProjectId}/${mediaType}/${filename}`;

        console.log(`  [Media Save] Saved → ${url}`);
        return { url, id };
    } catch (err) {
        console.error('  [Media Save] Failed to save media:', err.message);
        return null;
    }
}

/**
 * Sanitizes workflow nodes by converting base64 data to file URLs.
 * Prevents large base64 strings from bloating workflow JSON files.
 * @param {Array} nodes - Array of workflow nodes
 * @param {string} projectId - ID of the project for storage
 * @returns {Array} - Sanitized nodes with file URLs instead of base64
 */
function findExistingLastFrameUrl(projectId, nodeId) {
    if (!nodeId) return null;

    try {
        const imagesDir = getProjectMediaDir(projectId, 'images');
        if (!fs.existsSync(imagesDir)) return null;

        const metaFiles = fs.readdirSync(imagesDir).filter(f => f.endsWith('.json'));
        let matched = null;

        for (const file of metaFiles) {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(imagesDir, file), 'utf8'));
                if (meta?.nodeId === nodeId && meta?.prompt === 'Video Last Frame' && meta?.filename) {
                    if (!matched || new Date(meta.createdAt || 0) > new Date(matched.createdAt || 0)) {
                        matched = meta;
                    }
                }
            } catch { /* Skip malformed historical metadata. */ }
        }

        return matched ? `${getUrlPrefix()}/media/${projectId || 'default'}/images/${matched.filename}` : null;
    } catch {
        return null;
    }
}

function sanitizeWorkflowNodes(nodes, projectId) {
    if (!nodes || !Array.isArray(nodes)) return nodes;

    let sanitizedCount = 0;

    const sanitized = nodes.map(node => {
        const cleanNode = { ...node };
        const nodeId = cleanNode.id;

        // Check resultUrl for base64 data
        if (cleanNode.resultUrl && cleanNode.resultUrl.startsWith('data:')) {
            const saved = saveMediaToFile(cleanNode.resultUrl, projectId, 'Canvas Content', nodeId);
            if (saved) {
                cleanNode.resultUrl = saved.url;
                sanitizedCount++;
            }
        }

        // Check lastFrame for base64 data (video nodes)
        if (cleanNode.lastFrame && cleanNode.lastFrame.startsWith('data:')) {
            // 去重策略：同一 nodeId 的 Video Last Frame 只保存一次，后续复用已有文件
            const existingLastFrameUrl = findExistingLastFrameUrl(projectId, nodeId);
            if (existingLastFrameUrl) {
                cleanNode.lastFrame = existingLastFrameUrl;
            } else {
                const saved = saveMediaToFile(cleanNode.lastFrame, projectId, 'Video Last Frame', nodeId);
                if (saved) {
                    cleanNode.lastFrame = saved.url;
                    sanitizedCount++;
                }
            }
        }

        // Check editorCanvasData for base64 data (Image Editor)
        if (cleanNode.editorCanvasData && cleanNode.editorCanvasData.startsWith('data:')) {
            const saved = saveMediaToFile(cleanNode.editorCanvasData, projectId, 'Editor Content', nodeId);
            if (saved) {
                cleanNode.editorCanvasData = saved.url;
                sanitizedCount++;
            }
        }

        // Check editorBackgroundUrl for base64 data (Image Editor)
        if (cleanNode.editorBackgroundUrl && cleanNode.editorBackgroundUrl.startsWith('data:')) {
            const saved = saveMediaToFile(cleanNode.editorBackgroundUrl, projectId, 'Editor Background', nodeId);
            if (saved) {
                cleanNode.editorBackgroundUrl = saved.url;
                sanitizedCount++;
            }
        }

        return cleanNode;
    });

    if (sanitizedCount > 0) {
        console.log(`[Workflow Sanitize] Converted ${sanitizedCount} base64 field(s) to file URLs for project ${projectId}`);
    }

    return sanitized;
}

app.use(createTosRouter({
    uploadToTos: (buffer, filename, configuration) =>
        BaseProvider.uploadToTOS(buffer, filename, configuration),
    resolveLocalPath,
    getProjectMediaDir,
    generateAssetId,
    saveAssetMetadata,
    getUrlPrefix,
    getTosConfiguration: () => ({
        JIMENG_ACCESS_KEY: process.env.JIMENG_ACCESS_KEY || app.locals.JIMENG_ACCESS_KEY,
        JIMENG_SECRET_KEY: process.env.JIMENG_SECRET_KEY || app.locals.JIMENG_SECRET_KEY,
        TOS_BUCKET: process.env.TOS_BUCKET || app.locals.TOS_BUCKET,
        TOS_ENDPOINT: process.env.TOS_ENDPOINT || app.locals.TOS_ENDPOINT,
        TOS_REGION: process.env.TOS_REGION || app.locals.TOS_REGION
    })
}));


app.use('/api', createGenerationRouter({
    generationCoordinator: generationRuntime.coordinator,
    telemetryReporter: modelCallReporter
}));

// Mount Config routes (API keys management)
app.use('/api/config', configRoutes);

// 设置页按「站」分块渲染需要知道每站有哪些模型，这个对应关系只有后端目录里有。
app.use('/api', createModelSourceRouter({
    getProviderConfiguration: async (request, { waitForFresh = true } = {}) => {
        const requestIdentity = getAuthenticatedRequest(request);
        relayAccountService.assertUser(requestIdentity.identity.opaqueUserId);
        if (!waitForFresh) {
            // 节点首屏只读本机可信状态。即梦 CLI 探针和 Identity 绑定复核在后台刷新，
            // 不能让 15 秒 CLI 命令、向主进程取 Token 或远端网络挡住模型名称本身。
            const relayConfiguration = await relayAccountService.getBindingConfiguration({
                refresh: false
            });
            void dreaminaCliInstaller.isAuthenticated().catch(() => false);
            void libTvCli.isAuthenticated().catch(() => false);
            void requestIdentity.getAccessToken()
                .then((accessToken) => relayAccountService.getBindingConfiguration({
                    accessToken,
                    refresh: true
                }))
                .catch(() => undefined);
            const dreaminaAuthenticated = dreaminaCliInstaller.getCachedAuthentication();
            return {
                LibTvCliImageProvider: libTvCli.getCachedAuthentication(),
                LibTvCliVideoProvider: libTvCli.getCachedAuthentication(),
                DreaminaCliImageProvider: dreaminaAuthenticated,
                DreaminaCliVideoProvider: dreaminaAuthenticated,
                ...relayConfiguration
            };
        }
        const [dreaminaAuthenticated, relayConfiguration] = await Promise.all([
            dreaminaCliInstaller.isAuthenticated(),
            requestIdentity.getAccessToken().then((accessToken) =>
                relayAccountService.getBindingConfiguration({ accessToken })),
            libTvCli.isAuthenticated()
        ]);
        return {
            LibTvCliImageProvider: libTvCli.getCachedAuthentication(),
            LibTvCliVideoProvider: libTvCli.getCachedAuthentication(),
            DreaminaCliImageProvider: dreaminaAuthenticated,
            DreaminaCliVideoProvider: dreaminaAuthenticated,
            ...relayConfiguration
        };
    }
}));

app.use(createLegacyComfyGenerationRouter({
    workflowRegistry: WORKFLOW_REGISTRY,
    modelCallReporter,
    comfyProcessController,
    comfyClient,
    saveMediaToFile
}));


// NOTE: Old Kling helpers removed - now in server/services/kling.js

app.use(createLegacyLibraryRouter({
    baseLibraryDirectory: BASE_LIBRARY_DIR,
    libraryAssetsDirectory: getWorkspacePaths().LIBRARY_ASSETS_DIR,
    publicDirectory: RUNTIME_PATHS.PUBLIC_DIR,
    getProjectMediaDir,
    generateAssetId,
    saveAssetMetadata,
    resolveLocalPath,
    getUrlPrefix
}));


// --- User Workflows API ---

// 工作流已迁移至 SQLite，旧 JSON 过滤逻辑已废弃

// --- Folders API Routes ---

// 统一重建文件夹项目计数，避免历史逻辑分散导致计数漂移
async function syncFolderProjectCounts() {
    await workflowStore.syncFolderProjectCounts();
}

app.use('/api/workflows', createWorkflowRouter({
    store: workflowStore,
    sanitizeNodes: (nodes, projectId) => sanitizeWorkflowNodes(nodes, projectId),
    writeSnapshot: writeProjectJsonSnapshot,
    syncFolderProjectCounts
}));
app.use('/api/folders', createFolderRouter({
    store: workflowStore,
    writeSnapshot: writeProjectJsonSnapshot
}));
app.use('/api', createProjectTransferRouter({
    store: workflowStore,
    libraryDirectory: getWorkspacePaths().LIBRARY_DIR,
    mediaDirectory: getWorkspacePaths().LIBRARY_MEDIA_DIR,
    writeSnapshot: writeProjectJsonSnapshot,
    sanitizeNodes: (nodes, projectId) => sanitizeWorkflowNodes(nodes, projectId),
    syncFolderProjectCounts
}));


// Never let the SPA fallback turn an authenticated API/library miss into HTML 200.
app.use(['/api', '/library', '/diagnostics'], (_request, response) => {
    response.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
});

// Serve the sole product UI after authenticated route misses have been rejected.
if (process.env.NODE_ENV === 'production') {
    serveCanvas(app, RUNTIME_PATHS.DIST_DIR);
}

const runtime = createLocalRuntimeLifecycle({
    app,
    listen: LISTEN_TARGET,
    workflowStore,
    writeProjectSnapshot: writeProjectJsonSnapshot,
    codexService,
    canvasExternalService,
    // Ownership checks remain inside the controller: never stop user-owned ComfyUI.
    stopOwnedComfy: async () => {
        const result = await comfyProcessController.stop();
        if (result.status === 'stopped') console.log('[ComfyUI] 已随 AIFISHER 画布退出停止本机进程');
    }
});
const shutdown = launchRuntime(runtime,
    `Backend server running on ${describeListenTarget(LISTEN_TARGET)} (local only)`);
}
