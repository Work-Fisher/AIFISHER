/**
 * migrate-workflows.js
 * 
 * Migration script to convert old workflows with base64 data to file-based URLs.
 * Run this once to optimize all existing workflows.
 * 
 * Usage: node server/migrate-workflows.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKFLOWS_DIR = path.join(__dirname, '..', 'library', 'media');
const IMAGES_DIR = path.join(__dirname, '..', 'library', 'images');
const VIDEOS_DIR = path.join(__dirname, '..', 'library', 'videos');

// Ensure directories exist
[IMAGES_DIR, VIDEOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

let stats = {
    workflowsProcessed: 0,
    pathsUpdated: 0,
    imagesConverted: 0,
    videosConverted: 0,
    bytesFreed: 0
};

/**
 * Extract base64 data and save to file
 * @returns {string} File URL or original value if not base64
 */
function convertBase64ToFile(dataUrl, _type) {
    // ... existing Base64 logic if needed, but primary goal is path update ...
    if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;

    if (dataUrl.startsWith('/assets/')) {
        stats.pathsUpdated++;
        return dataUrl.replace('/assets/', '/library/');
    }

    // ... (keep base64 logic just in case, or simplify if we trust base64 is gone)
    // For safety, let's keep base64 logic but wrapped properly or just focus on path swap if that's the user's issue.
    // Given the user specifically "moved medias", base64 might not be the issue anymore, but keeping it is safe.

    // Check if it's a base64 data URL
    const imageMatch = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    const videoMatch = dataUrl.match(/^data:video\/(mp4|webm);base64,(.+)$/);

    if (imageMatch) {
        const ext = imageMatch[1] === 'jpeg' ? 'jpg' : imageMatch[1];
        const base64Data = imageMatch[2];
        const id = `migrated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const filename = `${id}.${ext}`;
        const filePath = path.join(IMAGES_DIR, filename);

        try {
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filePath, buffer);
            stats.imagesConverted++;
            stats.bytesFreed += dataUrl.length;
            console.log(`  ✓ Saved image: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
            return `/library/images/${filename}`;
        } catch (err) {
            console.error(`  ✗ Failed to save image: ${err.message}`);
            return dataUrl;
        }
    }

    if (videoMatch) {
        const ext = videoMatch[1];
        const base64Data = videoMatch[2];
        const id = `migrated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const filename = `${id}.${ext}`;
        const filePath = path.join(VIDEOS_DIR, filename);

        try {
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filePath, buffer);
            stats.videosConverted++;
            stats.bytesFreed += dataUrl.length;
            console.log(`  ✓ Saved video: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
            return `/library/videos/${filename}`;
        } catch (err) {
            console.error(`  ✗ Failed to save video: ${err.message}`);
            return dataUrl;
        }
    }

    return dataUrl;
}

/**
 * Process a single workflow file
 */
function processWorkflow(workflowPath) {
    const filename = path.basename(workflowPath);
    console.log(`\nProcessing: ${filename}`);

    try {
        const content = fs.readFileSync(workflowPath, 'utf8');
        const workflow = JSON.parse(content);

        let modified = false;

        // Process coverUrl
        if (workflow.coverUrl && workflow.coverUrl.includes('/assets/')) {
            workflow.coverUrl = workflow.coverUrl.replace('/assets/', '/library/');
            modified = true;
            stats.pathsUpdated++;
        }

        // Process each node
        if (workflow.nodes && Array.isArray(workflow.nodes)) {
            for (const node of workflow.nodes) {
                // Convert resultUrl (Base64 OR Path update)
                if (node.resultUrl) {
                    const newUrl = convertBase64ToFile(node.resultUrl, node.type);
                    if (newUrl !== node.resultUrl) {
                        node.resultUrl = newUrl;
                        modified = true;
                    }
                }

                // Convert lastFrame (video nodes)
                if (node.lastFrame) {
                    const newUrl = convertBase64ToFile(node.lastFrame, 'image');
                    if (newUrl !== node.lastFrame) {
                        node.lastFrame = newUrl;
                        modified = true;
                    }
                }
            }
        }

        // Save if modified
        if (modified) {
            fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
            console.log(`  → Workflow updated`);
        } else {
            console.log(`  → No changes needed`);
        }

        stats.workflowsProcessed++;

    } catch (err) {
        console.error(`  ✗ Error processing workflow: ${err.message}`);
    }
}

/**
 * Main migration function
 */
function migrate() {
    console.log('='.repeat(60));
    console.log('Workflow Migration: Base64 → File URLs');
    console.log('='.repeat(60));

    if (!fs.existsSync(WORKFLOWS_DIR)) {
        console.log('No workflows directory found. Nothing to migrate.');
        return;
    }

    const workflowFiles = fs.readdirSync(WORKFLOWS_DIR)
        .filter(f => f.endsWith('.json'));

    if (workflowFiles.length === 0) {
        console.log('No workflow files found. Nothing to migrate.');
        return;
    }

    console.log(`Found ${workflowFiles.length} workflow(s) to process...\n`);

    for (const file of workflowFiles) {
        processWorkflow(path.join(WORKFLOWS_DIR, file));
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Migration Complete!');
    console.log('='.repeat(60));
    console.log(`Workflows processed: ${stats.workflowsProcessed}`);
    console.log(`Images converted:    ${stats.imagesConverted}`);
    console.log(`Videos converted:    ${stats.videosConverted}`);
    console.log(`Space saved:         ${(stats.bytesFreed / 1024 / 1024).toFixed(2)} MB (in JSON)`);
    console.log('='.repeat(60));
}

// Run migration
migrate();
