import fs from 'fs';
import path from 'path';

const indexPath = path.join(process.cwd(), 'server', 'index.js');
let content = fs.readFileSync(indexPath, 'utf8');

// Add AsyncLocalStorage and workspace logic at the top
const importsStr = `import crypto from 'crypto';
import { spawn } from 'child_process';
import { AsyncLocalStorage } from 'async_hooks';

export const workspaceStorage = new AsyncLocalStorage();`;
content = content.replace(/import crypto from 'crypto';\nimport { spawn } from 'child_process';/, importsStr);

// Replace path constants
const pathsLogic = `
const BASE_LIBRARY_DIR = path.join(__dirname, '..', 'library');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

export function getWorkspacePaths() {
    const workspaceId = workspaceStorage.getStore();
    let libDir = BASE_LIBRARY_DIR;
    if (workspaceId) {
        libDir = path.join(BASE_LIBRARY_DIR, 'workspaces', workspaceId);
        if (!fs.existsSync(libDir)) {
            const mediaDir = path.join(libDir, 'media');
            const assetsDir = path.join(libDir, 'assets');
            [libDir, mediaDir, assetsDir].forEach(dir => {
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            });
            const foldersPath = path.join(libDir, 'folders.json');
            if (!fs.existsSync(foldersPath)) fs.writeFileSync(foldersPath, '[]');
        }
    }
    return {
        LIBRARY_DIR: libDir,
        LIBRARY_MEDIA_DIR: path.join(libDir, 'media'),
        WORKFLOWS_DIR: path.join(libDir, 'media'),
        LIBRARY_ASSETS_DIR: path.join(libDir, 'assets'),
        FOLDERS_JSON_PATH: path.join(libDir, 'folders.json')
    };
}

export function getUrlPrefix() {
    const workspaceId = workspaceStorage.getStore();
    return workspaceId ? \`/library/workspaces/\${workspaceId}\` : \`/library\`;
}

// Initial directories check
[BASE_LIBRARY_DIR, path.join(BASE_LIBRARY_DIR, 'media'), path.join(BASE_LIBRARY_DIR, 'assets'), LOGS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});
`;

content = content.replace(/\/\/ Ensure library directories exist[\s\S]*?fs\.mkdirSync\(dir, \{ recursive: true \}\);\n {4}\}\n\}\);/m, pathsLogic);

// Add middleware
const middlewareStr = `app.use(express.json({ limit: '200mb' }));

// Workspace Middleware
app.use((req, res, next) => {
    const workspaceId = req.headers['x-workspace-id'];
    if (workspaceId) {
        workspaceStorage.run(workspaceId, next);
    } else {
        workspaceStorage.run(null, next);
    }
});`;
content = content.replace(/app\.use\(express\.json\(\{ limit: '200mb' \}\)\);/, middlewareStr);

// Static file serving - ensure it uses BASE_LIBRARY_DIR
content = content.replace(/express\.static\(LIBRARY_DIR\)/g, "express.static(BASE_LIBRARY_DIR)");

// Set up app.locals with getters
const localsStr = `app.locals.HTTPS_PROXY = process.env.HTTPS_PROXY;

Object.defineProperty(app.locals, 'LIBRARY_DIR', { get: () => getWorkspacePaths().LIBRARY_DIR });
Object.defineProperty(app.locals, 'LIBRARY_MEDIA_DIR', { get: () => getWorkspacePaths().LIBRARY_MEDIA_DIR });`;
content = content.replace(/app\.locals\.HTTPS_PROXY = process\.env\.HTTPS_PROXY;\napp\.locals\.LIBRARY_DIR = LIBRARY_DIR;\napp\.locals\.LIBRARY_MEDIA_DIR = LIBRARY_MEDIA_DIR;/, localsStr);

// Replace occurrences of constants with getter calls
content = content.replace(/\bLIBRARY_DIR\b(?!\s*:|'|")/g, "getWorkspacePaths().LIBRARY_DIR");
content = content.replace(/\bLIBRARY_MEDIA_DIR\b(?!\s*:|'|")/g, "getWorkspacePaths().LIBRARY_MEDIA_DIR");
content = content.replace(/\bWORKFLOWS_DIR\b(?!\s*:|'|")/g, "getWorkspacePaths().WORKFLOWS_DIR");
content = content.replace(/\bLIBRARY_ASSETS_DIR\b(?!\s*:|'|")/g, "getWorkspacePaths().LIBRARY_ASSETS_DIR");
content = content.replace(/\bFOLDERS_JSON_PATH\b(?!\s*:|'|")/g, "getWorkspacePaths().FOLDERS_JSON_PATH");

// Fix URL generation
content = content.replace(/\/library\/media\//g, "`${getUrlPrefix()}/media/");
content = content.replace(/\/library\/assets\//g, "`${getUrlPrefix()}/assets/");
content = content.replace(/\/library\/images\//g, "`${getUrlPrefix()}/images/");
content = content.replace(/\/library\/videos\//g, "`${getUrlPrefix()}/videos/");
content = content.replace(/\/library\/\${type}\//g, "`${getUrlPrefix()}/${type}/");

fs.writeFileSync(indexPath, content);
console.log('Successfully updated server/index.js');