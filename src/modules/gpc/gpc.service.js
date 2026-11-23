'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { withTransaction } = require('../../lib/tx');

// ---------------------------------------------------------------------
// VALIDATION — runs identically for a dry-run and a real import. Nothing
// is written until a row set passes ALL of these checks.
// ---------------------------------------------------------------------
// Expected row shape (one row per Brick — the leaf level):
// { segmentCode, segmentTitle, familyCode, familyTitle, classCode, classTitle, brickCode, brickTitle }
// This is deliberately a flat, format-agnostic shape: whatever parses the
// actual GS1 Excel/XML file (not built yet — no real file supplied) must
// produce rows in this shape before calling importTaxonomy().
function validateRows(rows) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { valid: false, errors: ['No rows supplied'], stats: null };
  }

  const requiredCols = ['segmentCode', 'segmentTitle', 'familyCode', 'familyTitle', 'classCode', 'classTitle', 'brickCode', 'brickTitle'];
  rows.forEach((r, i) => {
    for (const col of requiredCols) {
      if (r[col] === undefined || r[col] === null || r[col] === '') {
        errors.push(`Row ${i}: missing required column '${col}'`);
      }
    }
  });
  if (errors.length) return { valid: false, errors, stats: null };

  // Duplicate Brick codes (the leaf we actually classify products against).
  const brickCodes = new Map();
  rows.forEach((r, i) => {
    if (brickCodes.has(r.brickCode)) errors.push(`Row ${i}: duplicate Brick code '${r.brickCode}' (first seen row ${brickCodes.get(r.brickCode)})`);
    else brickCodes.set(r.brickCode, i);
  });

  // Hierarchy consistency: every Brick's Class must map to exactly one
  // Family, every Class's Family to exactly one Segment — no row may
  // silently contradict another row's parent for the same code (an
  // "invalid/inconsistent parent", the orphan case the spec calls out).
  const classToFamily = new Map();
  const familyToSegment = new Map();
  rows.forEach((r, i) => {
    if (classToFamily.has(r.classCode) && classToFamily.get(r.classCode) !== r.familyCode) {
      errors.push(`Row ${i}: Class '${r.classCode}' maps to Family '${r.familyCode}' here but '${classToFamily.get(r.classCode)}' elsewhere`);
    } else {
      classToFamily.set(r.classCode, r.familyCode);
    }
    if (familyToSegment.has(r.familyCode) && familyToSegment.get(r.familyCode) !== r.segmentCode) {
      errors.push(`Row ${i}: Family '${r.familyCode}' maps to Segment '${r.segmentCode}' here but '${familyToSegment.get(r.familyCode)}' elsewhere`);
    } else {
      familyToSegment.set(r.familyCode, r.segmentCode);
    }
  });

  if (errors.length) return { valid: false, errors, stats: null };

  const segments = new Map();
  const families = new Map();
  const classes = new Map();
  rows.forEach((r) => {
    segments.set(r.segmentCode, r.segmentTitle);
    families.set(r.familyCode, { title: r.familyTitle, segmentCode: r.segmentCode });
    classes.set(r.classCode, { title: r.classTitle, familyCode: r.familyCode });
  });

  return {
    valid: true, errors: [],
    stats: { segments: segments.size, families: families.size, classes: classes.size, bricks: brickCodes.size },
    normalized: { segments, families, classes, bricks: rows },
  };
}

// FR-CLS-001 / Phase 4 — validate -> (dry-run stop here) -> commit as one
// new immutable version -> only a fully-valid version can become ACTIVE.
// Re-importing the same versionName is rejected (idempotent: it tells you
// it already exists rather than creating a duplicate or silently no-op'ing).
function importTaxonomy(db, session, { versionName, source, rows, dryRun }) {
  if (!versionName) throw new ApiError('VALIDATION_ERROR', 'versionName is required (e.g. "2026-05")');

  const result = validateRows(rows);

  if (dryRun) {
    return { versionName, dryRun: true, valid: result.valid, errors: result.errors, stats: result.stats };
  }

  if (!result.valid) {
    // Record the rejected attempt for provenance, but never activate it.
    const id = nextId('gpcv');
    db.prepare(`
      INSERT INTO gpc_taxonomy_versions (id, version_name, source, status, is_active, row_counts, validation_report, imported_by, imported_at)
      VALUES (?, ?, ?, 'REJECTED', 0, NULL, ?, ?, ?)
    `).run(id, versionName, source || null, JSON.stringify(result.errors), session.userId, now());
    throw new ApiError('VALIDATION_ERROR', `GPC import rejected: ${result.errors.length} error(s). First: ${result.errors[0]}`);
  }

  const existing = db.prepare(`SELECT id FROM gpc_taxonomy_versions WHERE version_name = ?`).get(versionName);
  if (existing) throw new ApiError('VALIDATION_ERROR', `Taxonomy version '${versionName}' was already imported (idempotency guard) — use a new version name`);

  return withTransaction(db, () => {
    const versionId = nextId('gpcv');

    // Deactivate the currently active version (its data rows are KEPT —
    // "never silently overwrite a previous taxonomy version").
    db.prepare(`UPDATE gpc_taxonomy_versions SET is_active = 0, status = 'SUPERSEDED' WHERE is_active = 1`).run();

    db.prepare(`
      INSERT INTO gpc_taxonomy_versions (id, version_name, source, status, is_active, row_counts, validation_report, imported_by, imported_at)
      VALUES (?, ?, ?, 'ACTIVE', 1, ?, '[]', ?, ?)
    `).run(versionId, versionName, source || null, JSON.stringify(result.stats), session.userId, now());

    for (const [code, title] of result.normalized.segments) {
      db.prepare(`INSERT INTO gpc_segments (id, version_id, code, title) VALUES (?, ?, ?, ?)`).run(nextId('seg'), versionId, code, title);
    }
    for (const [code, f] of result.normalized.families) {
      db.prepare(`INSERT INTO gpc_families (id, version_id, segment_code, code, title) VALUES (?, ?, ?, ?, ?)`).run(nextId('fam'), versionId, f.segmentCode, code, f.title);
    }
    for (const [code, c] of result.normalized.classes) {
      db.prepare(`INSERT INTO gpc_classes (id, version_id, family_code, code, title) VALUES (?, ?, ?, ?, ?)`).run(nextId('cls'), versionId, c.familyCode, code, c.title);
    }
    for (const r of result.normalized.bricks) {
      db.prepare(`INSERT INTO gpc_bricks (id, version_id, class_code, code, title) VALUES (?, ?, ?, ?, ?)`).run(nextId('brk'), versionId, r.classCode, r.brickCode, r.brickTitle);
    }

    writeAudit(db, { businessId: null, actorId: session.userId, action: 'IMPORT', resource: 'gpc_taxonomy_version', resourceId: versionId, newState: result.stats });

    return { versionId, versionName, status: 'ACTIVE', stats: result.stats };
  });
}

function getActiveVersion(db) {
  const row = db.prepare(`SELECT * FROM gpc_taxonomy_versions WHERE is_active = 1`).get();
  if (!row) return null;
  return { id: row.id, versionName: row.version_name, source: row.source, importedAt: row.imported_at, stats: JSON.parse(row.row_counts || '{}') };
}

function listVersions(db) {
  return db.prepare(`SELECT * FROM gpc_taxonomy_versions ORDER BY imported_at DESC`).all()
    .map((r) => ({ id: r.id, versionName: r.version_name, status: r.status, isActive: !!r.is_active, importedAt: r.imported_at }));
}

function browseSegments(db) {
  const active = getActiveVersion(db);
  if (!active) return { active: null, data: [] };
  return { active: active.versionName, data: db.prepare(`SELECT code, title FROM gpc_segments WHERE version_id = ? ORDER BY code`).all(active.id) };
}

function browseFamilies(db, segmentCode) {
  const active = getActiveVersion(db);
  if (!active) return { active: null, data: [] };
  if (!segmentCode) throw new ApiError('VALIDATION_ERROR', 'segmentCode is required');
  return { active: active.versionName, data: db.prepare(`SELECT code, title FROM gpc_families WHERE version_id = ? AND segment_code = ? ORDER BY code`).all(active.id, segmentCode) };
}

function browseClasses(db, familyCode) {
  const active = getActiveVersion(db);
  if (!active) return { active: null, data: [] };
  if (!familyCode) throw new ApiError('VALIDATION_ERROR', 'familyCode is required');
  return { active: active.versionName, data: db.prepare(`SELECT code, title FROM gpc_classes WHERE version_id = ? AND family_code = ? ORDER BY code`).all(active.id, familyCode) };
}

function browseBricks(db, classCode) {
  const active = getActiveVersion(db);
  if (!active) return { active: null, data: [] };
  if (!classCode) throw new ApiError('VALIDATION_ERROR', 'classCode is required');
  return { active: active.versionName, data: db.prepare(`SELECT code, title FROM gpc_bricks WHERE version_id = ? AND class_code = ? ORDER BY code`).all(active.id, classCode) };
}

function searchBricks(db, query) {
  const active = getActiveVersion(db);
  if (!active) return { active: null, data: [] };
  if (!query) throw new ApiError('VALIDATION_ERROR', 'q is required');
  return { active: active.versionName, data: db.prepare(`SELECT code, title, class_code FROM gpc_bricks WHERE version_id = ? AND title LIKE ? ORDER BY title LIMIT 50`).all(active.id, `%${query}%`) };
}

module.exports = { validateRows, importTaxonomy, getActiveVersion, listVersions, browseSegments, browseFamilies, browseClasses, browseBricks, searchBricks };
