import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { BASE_LIBRARY_DIR } from '../workspace/workspacePaths.js';

const sqlite = sqlite3.verbose();
export const SQLITE_WORKFLOW_SCHEMA_VERSION = 4;

function safeParseJson(text, fallback) {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

function parseWorkflowPayload(text) {
    try {
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
        return payload;
    } catch {
        return null;
    }
}

// 工作流 SQLite 存储：替代项目 JSON / 备份 JSON
export class SQLiteWorkflowStore {
    constructor(options = {}) {
        const dbPath = options.dbPath || path.join(BASE_LIBRARY_DIR, 'workflows.db');
        this.dbPath = dbPath;
        this.libraryDir = options.libraryDir || path.dirname(dbPath);
        this.db = null;
        this.initPromise = null;
        this.workflowColumns = new Set();
        this.folderColumns = new Set();
        this.recoveryPointLimit = Number(options.recoveryPointLimit || 20);
        this.startupRecoveryReport = [];
        this.lastMigrationBackupPath = null;
    }

    async init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            const dbDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            this.db = await new Promise((resolve, reject) => {
                const instance = new sqlite.Database(this.dbPath, (err) => {
                    if (err) return reject(err);
                    resolve(instance);
                });
            });

            await this.run(`PRAGMA journal_mode = WAL`);
            await this.run(`PRAGMA synchronous = NORMAL`);
            await this.run(`PRAGMA temp_store = MEMORY`);
            await this.run(`PRAGMA busy_timeout = 5000`);

            await this.applySchemaMigrations();

            // 启动时自动迁移旧版项目 JSON，保证升级后可直接读取历史项目
            await this.migrateFromLegacyJsonIfNeeded();
            // 启动时自动迁移旧版 folders.json
            await this.migrateFoldersFromJsonIfNeeded();
            // 启动时先隔离损坏记录；有有效恢复点时自动恢复为更高 revision。
            await this.recoverCorruptedWorkflows({ skipInit: true });
            // 启动后统一重建一次文件夹项目计数，避免历史脏数据
            await this.syncFolderProjectCounts({ skipInit: true });
        })();

        return this.initPromise;
    }

    async close() {
        if (!this.db) return;
        const database = this.db;
        await new Promise((resolve, reject) => {
            database.close((error) => (error ? reject(error) : resolve()));
        });
        this.db = null;
        this.initPromise = null;
    }

    getStartupRecoveryReport() {
        return this.startupRecoveryReport.map((item) => ({ ...item }));
    }

    async listWorkflowQuarantine() {
        await this.init();
        const rows = await this.all(
            `SELECT id, workflow_id, detected_at, reason, action, recovery_point_id
             FROM workflow_quarantine
             ORDER BY datetime(detected_at) DESC, rowid DESC`
        );
        return rows.map((row) => ({
            id: row.id,
            workflowId: row.workflow_id,
            detectedAt: row.detected_at,
            reason: row.reason,
            action: row.action,
            recoveryPointId: row.recovery_point_id || null
        }));
    }

    async getSchemaVersion(options = {}) {
        if (!options.skipInit) await this.init();
        const row = await this.get(`PRAGMA user_version`);
        return Number(row?.user_version || 0);
    }

    getLastMigrationBackupPath() {
        return this.lastMigrationBackupPath;
    }

    async createMigrationBackup(currentVersion) {
        const schemaRow = await this.get(
            `SELECT COUNT(1) AS c FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'`
        );
        if (Number(schemaRow?.c || 0) === 0) return null;

        const backupDirectory = path.join(this.libraryDir, '.migration-backups');
        fs.mkdirSync(backupDirectory, { recursive: true });
        const timestamp = new Date().toISOString().replaceAll(':', '-');
        const backupPath = path.join(
            backupDirectory,
            `workflows-v${currentVersion}-${timestamp}-${crypto.randomUUID()}.db`
        );
        const escapedBackupPath = backupPath.replaceAll("'", "''");
        await this.run(`VACUUM INTO '${escapedBackupPath}'`);
        this.lastMigrationBackupPath = backupPath;
        return backupPath;
    }

    async applySchemaMigrations() {
        let currentVersion = await this.getSchemaVersion({ skipInit: true });
        if (currentVersion > SQLITE_WORKFLOW_SCHEMA_VERSION) {
            const error = new Error(
                `DATABASE_SCHEMA_TOO_NEW:${currentVersion}>${SQLITE_WORKFLOW_SCHEMA_VERSION}`
            );
            error.code = 'DATABASE_SCHEMA_TOO_NEW';
            throw error;
        }

        if (currentVersion < SQLITE_WORKFLOW_SCHEMA_VERSION) {
            await this.createMigrationBackup(currentVersion);
        }

        while (currentVersion < SQLITE_WORKFLOW_SCHEMA_VERSION) {
            const targetVersion = currentVersion + 1;
            await this.run(`BEGIN IMMEDIATE`);
            try {
                await this.applySchemaMigration(targetVersion);
                await this.run(`PRAGMA user_version = ${targetVersion}`);
                await this.run(`COMMIT`);
                currentVersion = targetVersion;
            } catch (error) {
                try {
                    await this.run(`ROLLBACK`);
                } catch (rollbackError) {
                    error.rollbackError = rollbackError;
                }
                error.schemaMigrationTarget = targetVersion;
                throw error;
            }
        }

        // 缓存实际列集合，供读写兼容逻辑使用。
        await this.ensureWorkflowSchema();
        await this.ensureFolderSchema();
    }

    async applySchemaMigration(version) {
        if (version === 1) {
            await this.run(`
                CREATE TABLE IF NOT EXISTS workflows (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'work',
                    folder_id TEXT,
                    cover_url TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    node_count INTEGER NOT NULL DEFAULT 0,
                    payload_json TEXT NOT NULL
                )
            `);
            await this.run(`
                CREATE TABLE IF NOT EXISTS folders (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    parent_id TEXT,
                    project_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            `);
            await this.ensureWorkflowSchema();
            await this.ensureFolderSchema();
            await this.run(`CREATE INDEX IF NOT EXISTS idx_workflows_status_updated ON workflows(status, updated_at DESC)`);
            await this.run(`CREATE INDEX IF NOT EXISTS idx_workflows_folder ON workflows(folder_id)`);
            await this.run(`CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)`);
            await this.run(`CREATE INDEX IF NOT EXISTS idx_folders_updated ON folders(updated_at DESC)`);
            return;
        }

        if (version === 2) {
            await this.run(`
                CREATE TABLE IF NOT EXISTS workflow_recovery_points (
                    id TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                )
            `);
            await this.run(`CREATE INDEX IF NOT EXISTS idx_recovery_workflow_created ON workflow_recovery_points(workflow_id, created_at DESC)`);
            return;
        }

        if (version === 3) {
            await this.run(`
                CREATE TABLE IF NOT EXISTS workflow_quarantine (
                    id TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL,
                    detected_at TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    action TEXT NOT NULL,
                    recovery_point_id TEXT,
                    raw_record_json TEXT NOT NULL
                )
            `);
            await this.run(`CREATE INDEX IF NOT EXISTS idx_quarantine_workflow_detected ON workflow_quarantine(workflow_id, detected_at DESC)`);
            return;
        }

        if (version === 4) {
            await this.ensureWorkflowSchema();
            if (this.workflowColumns.has('data_json')) {
                await this.run(`
                    UPDATE workflows
                    SET payload_json = data_json
                    WHERE data_json IS NOT NULL
                      AND TRIM(data_json) NOT IN ('', '{}')
                      AND (payload_json IS NULL OR TRIM(payload_json) IN ('', '{}'))
                `);
            }
            return;
        }

        throw new Error(`UNKNOWN_SCHEMA_MIGRATION:${version}`);
    }

    async ensureWorkflowSchema() {
        const rows = await this.all(`PRAGMA table_info(workflows)`);
        const columnSet = new Set((rows || []).map((row) => row.name));
        this.workflowColumns = new Set(columnSet);

        const requiredColumns = [
            { name: 'revision', definition: `INTEGER NOT NULL DEFAULT 0` },
            { name: 'status', definition: `TEXT NOT NULL DEFAULT 'work'` },
            { name: 'folder_id', definition: `TEXT` },
            { name: 'cover_url', definition: `TEXT` },
            { name: 'created_at', definition: `TEXT NOT NULL DEFAULT ''` },
            { name: 'updated_at', definition: `TEXT NOT NULL DEFAULT ''` },
            { name: 'node_count', definition: `INTEGER NOT NULL DEFAULT 0` },
            { name: 'payload_json', definition: `TEXT NOT NULL DEFAULT '{}'` }
        ];

        for (const column of requiredColumns) {
            if (columnSet.has(column.name)) continue;
            await this.run(`ALTER TABLE workflows ADD COLUMN ${column.name} ${column.definition}`);
            this.workflowColumns.add(column.name);
        }
    }

    async ensureFolderSchema() {
        const rows = await this.all(`PRAGMA table_info(folders)`);
        const columnSet = new Set((rows || []).map((row) => row.name));
        this.folderColumns = new Set(columnSet);

        const requiredColumns = [
            { name: 'name', definition: `TEXT NOT NULL DEFAULT '未命名文件夹'` },
            { name: 'parent_id', definition: `TEXT` },
            { name: 'project_count', definition: `INTEGER NOT NULL DEFAULT 0` },
            { name: 'created_at', definition: `TEXT NOT NULL DEFAULT ''` },
            { name: 'updated_at', definition: `TEXT NOT NULL DEFAULT ''` }
        ];

        for (const column of requiredColumns) {
            if (columnSet.has(column.name)) continue;
            await this.run(`ALTER TABLE folders ADD COLUMN ${column.name} ${column.definition}`);
            this.folderColumns.add(column.name);
        }
    }

    // 旧版工作流文件名过滤：仅保留项目根 JSON，排除备份与临时文件
    isLegacyWorkflowFile(filename) {
        return filename.endsWith('.json') && !filename.endsWith('_bakup.json') && !filename.endsWith('.id.json');
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function onRun(err) {
                if (err) return reject(err);
                resolve(this);
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    }

    async runInTransaction(task) {
        await this.init();
        await this.run(`BEGIN IMMEDIATE`);
        try {
            const result = await task();
            await this.run(`COMMIT`);
            return result;
        } catch (error) {
            try {
                await this.run(`ROLLBACK`);
            } catch (rollbackError) {
                error.rollbackError = rollbackError;
            }
            throw error;
        }
    }

    toWorkflow(row) {
        if (!row) return null;
        const rawPayload = row.payload_json || row.data_json || '{}';
        const payload = safeParseJson(rawPayload, {});
        return {
            ...payload,
            id: row.id,
            title: row.title || payload.title || 'Untitled',
            revision: Number(row.revision || 0),
            status: row.status || 'work',
            folderId: row.folder_id || null,
            coverUrl: row.cover_url || null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
            groups: Array.isArray(payload.groups) ? payload.groups : []
        };
    }

    async saveWorkflow(incomingWorkflow, options = {}) {
        if (!options.skipInit) {
            await this.init();
        }

        const workflow = { ...(incomingWorkflow || {}) };
        if (!workflow.id) workflow.id = crypto.randomUUID();

        const existing = await this.get(`SELECT * FROM workflows WHERE id = ?`, [workflow.id]);
        const existingRevision = Number(existing?.revision || 0);
        const incomingRevision = Number(workflow.revision || 0);

        // 乐观并发控制：防止旧版本覆盖
        if (existing && incomingRevision < existingRevision) {
            const error = new Error('REVISION_CONFLICT');
            error.code = 'REVISION_CONFLICT';
            error.currentRevision = existingRevision;
            throw error;
        }

        const now = new Date().toISOString();
        const revision = existingRevision + 1;
        const createdAt = existing?.created_at || workflow.createdAt || now;
        const status = workflow.status || existing?.status || 'work';
        const folderId = workflow.folderId ?? existing?.folder_id ?? null;
        const coverUrl = workflow.coverUrl ?? existing?.cover_url ?? null;

        let nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
        if (typeof options.sanitizeNodes === 'function') {
            nodes = options.sanitizeNodes(nodes, workflow.id);
        }

        const groups = Array.isArray(workflow.groups) ? workflow.groups : [];
        const payload = {
            ...workflow,
            id: workflow.id,
            revision,
            status,
            folderId,
            coverUrl,
            createdAt,
            updatedAt: now,
            nodes,
            groups
        };

        const nodeCount = nodes.length;
        const payloadText = JSON.stringify(payload);
        const hasDataJsonColumn = this.workflowColumns.has('data_json');

        const insertSql = hasDataJsonColumn
            ? `INSERT INTO workflows (id, title, revision, status, folder_id, cover_url, created_at, updated_at, node_count, payload_json, data_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title,
                 revision=excluded.revision,
                 status=excluded.status,
                 folder_id=excluded.folder_id,
                 cover_url=excluded.cover_url,
                 created_at=excluded.created_at,
                 updated_at=excluded.updated_at,
                 node_count=excluded.node_count,
                 payload_json=excluded.payload_json,
                 data_json=excluded.data_json`
            : `INSERT INTO workflows (id, title, revision, status, folder_id, cover_url, created_at, updated_at, node_count, payload_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title,
                 revision=excluded.revision,
                 status=excluded.status,
                 folder_id=excluded.folder_id,
                 cover_url=excluded.cover_url,
                 created_at=excluded.created_at,
                 updated_at=excluded.updated_at,
                 node_count=excluded.node_count,
                 payload_json=excluded.payload_json`;

        const insertParams = hasDataJsonColumn
            ? [
                workflow.id,
                payload.title || 'Untitled',
                revision,
                status,
                folderId,
                coverUrl,
                createdAt,
                now,
                nodeCount,
                payloadText,
                payloadText
            ]
            : [
                workflow.id,
                payload.title || 'Untitled',
                revision,
                status,
                folderId,
                coverUrl,
                createdAt,
                now,
                nodeCount,
                payloadText
            ];

        await this.run(
            insertSql,
            insertParams
        );

        return { id: workflow.id, revision };
    }

    async listWorkflows() {
        await this.init();
        const rows = await this.all(
            `SELECT id, title, revision, status, folder_id, cover_url, created_at, updated_at, node_count
             FROM workflows
             WHERE status != 'delete'
             ORDER BY datetime(updated_at) DESC`
        );

        return rows.map((row) => ({
            id: row.id,
            title: row.title || 'Untitled',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            nodeCount: Number(row.node_count || 0),
            coverUrl: row.cover_url || null,
            folderId: row.folder_id || null,
            status: row.status || 'work'
        }));
    }

    async exportLibraryCatalog() {
        await this.init();
        const workflowRows = await this.all(
            `SELECT * FROM workflows WHERE status != 'delete' ORDER BY datetime(updated_at) DESC`
        );
        return {
            workflows: workflowRows.map((row) => this.toWorkflow(row)),
            folders: await this.listFolders()
        };
    }

    async getActiveWorkflowCountByFolderId(folderId) {
        await this.init();
        const row = await this.get(
            `SELECT COUNT(1) AS c FROM workflows WHERE status != 'delete' AND folder_id IS ?`,
            [folderId ?? null]
        );
        return Number(row?.c || 0);
    }

    async getWorkflowById(id) {
        await this.init();
        const row = await this.get(`SELECT * FROM workflows WHERE id = ?`, [id]);
        return this.toWorkflow(row);
    }

    async recoverCorruptedWorkflows(options = {}) {
        if (!options.skipInit) await this.init();
        this.startupRecoveryReport = [];
        const workflowRows = await this.all(`SELECT * FROM workflows`);

        for (const row of workflowRows) {
            const payload = parseWorkflowPayload(row.payload_json || row.data_json || '');
            if (payload) continue;

            const recoveryRows = await this.all(
                `SELECT id, payload_json
                 FROM workflow_recovery_points
                 WHERE workflow_id = ?
                 ORDER BY datetime(created_at) DESC, rowid DESC`,
                [row.id]
            );
            const recoveryRow = recoveryRows.find((candidate) => parseWorkflowPayload(candidate.payload_json));
            const quarantineId = crypto.randomUUID();
            const detectedAt = new Date().toISOString();
            const action = recoveryRow ? 'recovered' : 'isolated';

            await this.run(
                `INSERT INTO workflow_quarantine
                 (id, workflow_id, detected_at, reason, action, recovery_point_id, raw_record_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    quarantineId,
                    row.id,
                    detectedAt,
                    'INVALID_PAYLOAD_JSON',
                    action,
                    recoveryRow?.id || null,
                    JSON.stringify(row)
                ]
            );

            if (recoveryRow) {
                const recoveredPayload = parseWorkflowPayload(recoveryRow.payload_json);
                const result = await this.saveWorkflow(
                    {
                        ...recoveredPayload,
                        id: row.id,
                        revision: Number(row.revision || 0)
                    },
                    { skipInit: true }
                );
                this.startupRecoveryReport.push({
                    workflowId: row.id,
                    action,
                    recoveryPointId: recoveryRow.id,
                    quarantineId,
                    revision: result.revision
                });
                continue;
            }

            await this.run(`DELETE FROM workflows WHERE id = ?`, [row.id]);
            this.startupRecoveryReport.push({
                workflowId: row.id,
                action,
                recoveryPointId: null,
                quarantineId,
                revision: Number(row.revision || 0)
            });
        }

        return this.getStartupRecoveryReport();
    }

    async createWorkflowRecoveryPoint(workflowId, reason = 'manual-save') {
        await this.init();
        const workflow = await this.getWorkflowById(workflowId);
        if (!workflow) return null;

        const recoveryPoint = {
            id: crypto.randomUUID(),
            workflowId,
            revision: Number(workflow.revision || 0),
            reason,
            createdAt: new Date().toISOString()
        };
        await this.run(
            `INSERT INTO workflow_recovery_points (id, workflow_id, revision, reason, created_at, payload_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                recoveryPoint.id,
                recoveryPoint.workflowId,
                recoveryPoint.revision,
                recoveryPoint.reason,
                recoveryPoint.createdAt,
                JSON.stringify(workflow)
            ]
        );
        await this.run(
            `DELETE FROM workflow_recovery_points
             WHERE workflow_id = ?
               AND id NOT IN (
                 SELECT id FROM workflow_recovery_points
                 WHERE workflow_id = ?
                 ORDER BY datetime(created_at) DESC, rowid DESC
                 LIMIT ?
               )`,
            [workflowId, workflowId, this.recoveryPointLimit]
        );
        return recoveryPoint;
    }

    async listWorkflowRecoveryPoints(workflowId) {
        await this.init();
        const rows = await this.all(
            `SELECT id, workflow_id, revision, reason, created_at
             FROM workflow_recovery_points
             WHERE workflow_id = ?
             ORDER BY datetime(created_at) DESC, rowid DESC`,
            [workflowId]
        );
        return rows.map((row) => ({
            id: row.id,
            workflowId: row.workflow_id,
            revision: Number(row.revision || 0),
            reason: row.reason,
            createdAt: row.created_at
        }));
    }

    async restoreWorkflowRecoveryPoint(workflowId, recoveryPointId, options = {}) {
        await this.init();
        const row = await this.get(
            `SELECT payload_json FROM workflow_recovery_points WHERE id = ? AND workflow_id = ?`,
            [recoveryPointId, workflowId]
        );
        if (!row) return null;

        const archivedWorkflow = safeParseJson(row.payload_json, null);
        if (!archivedWorkflow || typeof archivedWorkflow !== 'object') {
            const error = new Error('RECOVERY_POINT_CORRUPTED');
            error.code = 'RECOVERY_POINT_CORRUPTED';
            throw error;
        }

        const currentWorkflow = await this.getWorkflowById(workflowId);
        if (currentWorkflow) {
            await this.createWorkflowRecoveryPoint(workflowId, 'before-restore');
        }
        return this.saveWorkflow(
            {
                ...archivedWorkflow,
                id: workflowId,
                revision: Number(currentWorkflow?.revision || 0)
            },
            options
        );
    }

    async updateById(id, updater) {
        const current = await this.getWorkflowById(id);
        if (!current) return null;

        const next = updater({ ...current }) || null;
        if (!next) return null;

        const now = new Date().toISOString();
        next.id = id;
        next.revision = Number(current.revision || 0) + 1;
        next.createdAt = current.createdAt || now;
        next.updatedAt = now;
        if (!Array.isArray(next.nodes)) next.nodes = [];
        if (!Array.isArray(next.groups)) next.groups = [];
        if (!next.status) next.status = 'work';
        const payloadText = JSON.stringify(next);
        const hasDataJsonColumn = this.workflowColumns.has('data_json');

        const updateSql = hasDataJsonColumn
            ? `UPDATE workflows
               SET title = ?, revision = ?, status = ?, folder_id = ?, cover_url = ?, created_at = ?, updated_at = ?, node_count = ?, payload_json = ?, data_json = ?
               WHERE id = ?`
            : `UPDATE workflows
               SET title = ?, revision = ?, status = ?, folder_id = ?, cover_url = ?, created_at = ?, updated_at = ?, node_count = ?, payload_json = ?
               WHERE id = ?`;

        const updateParams = hasDataJsonColumn
            ? [
                next.title || 'Untitled',
                Number(next.revision || 0),
                next.status,
                next.folderId ?? null,
                next.coverUrl ?? null,
                next.createdAt,
                next.updatedAt,
                next.nodes.length,
                payloadText,
                payloadText,
                id
            ]
            : [
                next.title || 'Untitled',
                Number(next.revision || 0),
                next.status,
                next.folderId ?? null,
                next.coverUrl ?? null,
                next.createdAt,
                next.updatedAt,
                next.nodes.length,
                payloadText,
                id
            ];

        await this.run(
            updateSql,
            updateParams
        );

        return next;
    }

    async renameWorkflow(id, title) {
        return this.updateById(id, (w) => ({ ...w, title: (title || '').trim() || w.title }));
    }

    async moveWorkflow(id, folderId) {
        return this.updateById(id, (w) => ({ ...w, folderId: folderId ?? null }));
    }

    // 物理删除项目：直接从 SQLite 中移除
    async deleteWorkflow(id) {
        await this.init();
        const result = await this.run(`DELETE FROM workflows WHERE id = ?`, [id]);
        return (result?.changes || 0) > 0;
    }

    async updateWorkflowCover(id, coverUrl) {
        const result = await this.updateById(id, (w) => ({ ...w, coverUrl: coverUrl ?? null }));
        return !!result;
    }

    async clearFolderReferences(folderId) {
        await this.init();
        const rows = await this.all(`SELECT id FROM workflows WHERE folder_id = ?`, [folderId]);
        for (const row of rows) {
            await this.updateById(row.id, (w) => ({ ...w, folderId: null }));
        }
        return rows.map((row) => row.id);
    }

    toFolder(row) {
        if (!row) return null;
        return {
            id: row.id,
            name: row.name || '未命名文件夹',
            parentId: row.parent_id || null,
            projectCount: Number(row.project_count || 0),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    async listFolders() {
        await this.init();
        const rows = await this.all(
            `SELECT id, name, parent_id, project_count, created_at, updated_at
             FROM folders
             ORDER BY datetime(updated_at) DESC`
        );
        return rows.map((row) => this.toFolder(row));
    }

    async getFolderById(folderId) {
        await this.init();
        const row = await this.get(
            `SELECT id, name, parent_id, project_count, created_at, updated_at FROM folders WHERE id = ?`,
            [folderId]
        );
        return this.toFolder(row);
    }

    async saveFolder(incomingFolder = {}) {
        await this.init();
        const now = new Date().toISOString();
        const id = incomingFolder.id || crypto.randomUUID();
        const existing = await this.get(`SELECT * FROM folders WHERE id = ?`, [id]);

        const name = (incomingFolder.name || existing?.name || '未命名文件夹').trim() || '未命名文件夹';
        const parentId = incomingFolder.parentId ?? existing?.parent_id ?? null;
        const createdAt = existing?.created_at || incomingFolder.createdAt || now;
        const updatedAt = now;
        const projectCount = Number.isFinite(incomingFolder.projectCount)
            ? Number(incomingFolder.projectCount)
            : Number(existing?.project_count || 0);

        await this.run(
            `INSERT INTO folders (id, name, parent_id, project_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               parent_id = excluded.parent_id,
               project_count = excluded.project_count,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at`,
            [id, name, parentId, projectCount, createdAt, updatedAt]
        );

        const row = await this.get(`SELECT * FROM folders WHERE id = ?`, [id]);
        return this.toFolder(row);
    }

    async deleteFolder(folderId) {
        await this.init();
        const result = await this.run(`DELETE FROM folders WHERE id = ?`, [folderId]);
        return (result?.changes || 0) > 0;
    }

    async syncFolderProjectCounts(options = {}) {
        if (!options.skipInit) {
            await this.init();
        }
        await this.run(`UPDATE folders SET project_count = 0`);
        const rows = await this.all(
            `SELECT folder_id, COUNT(1) AS c
             FROM workflows
             WHERE status != 'delete' AND folder_id IS NOT NULL
             GROUP BY folder_id`
        );

        for (const row of rows) {
            await this.run(`UPDATE folders SET project_count = ? WHERE id = ?`, [
                Number(row.c || 0),
                row.folder_id
            ]);
        }
    }

    // 仅在工作流表为空时执行一次迁移，避免重复导入
    async migrateFromLegacyJsonIfNeeded() {
        const countRow = await this.get(`SELECT COUNT(1) AS c FROM workflows`);
        const existingCount = Number(countRow?.c || 0);
        if (existingCount > 0) return;

        const legacyDir = path.join(this.libraryDir, 'media');
        if (!fs.existsSync(legacyDir)) return;

        const files = fs.readdirSync(legacyDir).filter((f) => this.isLegacyWorkflowFile(f));
        if (files.length === 0) return;

        let imported = 0;
        for (const file of files) {
            try {
                const fullPath = path.join(legacyDir, file);
                const raw = fs.readFileSync(fullPath, 'utf8');
                const parsed = safeParseJson(raw, null);
                if (!parsed || typeof parsed !== 'object') continue;

                // 只迁移具备 nodes/groups 核心结构的项目 JSON
                if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.groups)) continue;

                await this.saveWorkflow(parsed, { skipInit: true });
                imported += 1;
            } catch (error) {
                console.warn(`[WorkflowStore] 迁移旧项目失败: ${file}`, error?.message || error);
            }
        }

        if (imported > 0) {
            console.log(`[WorkflowStore] 已完成旧项目迁移: ${imported} 个工作流已写入 SQLite`);
        }
    }

    async migrateFoldersFromJsonIfNeeded() {
        const countRow = await this.get(`SELECT COUNT(1) AS c FROM folders`);
        const existingCount = Number(countRow?.c || 0);
        if (existingCount > 0) return;

        const legacyPath = path.join(this.libraryDir, 'folders.json');
        if (!fs.existsSync(legacyPath)) return;

        const folders = safeParseJson(fs.readFileSync(legacyPath, 'utf8'), []);
        if (!Array.isArray(folders) || folders.length === 0) return;

        let imported = 0;
        for (const folder of folders) {
            if (!folder || typeof folder !== 'object') continue;
            const id = folder.id || crypto.randomUUID();
            const now = new Date().toISOString();
            const name = (folder.name || '未命名文件夹').trim() || '未命名文件夹';
            const parentId = folder.parentId ?? null;
            const projectCount = Number.isFinite(folder.projectCount) ? Number(folder.projectCount) : 0;
            const createdAt = folder.createdAt || now;
            const updatedAt = folder.updatedAt || now;

            await this.run(
                `INSERT OR REPLACE INTO folders (id, name, parent_id, project_count, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [id, name, parentId, projectCount, createdAt, updatedAt]
            );
            imported += 1;
        }

        if (imported > 0) {
            console.log(`[WorkflowStore] 已完成 folders.json 迁移: ${imported} 个文件夹已写入 SQLite`);
        }
    }
}

export const workflowStore = new SQLiteWorkflowStore();
