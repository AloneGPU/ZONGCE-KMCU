const path = require('path');

function normalizeProofFile(item) {
  if (typeof item === 'string') {
    const proofPath = item.trim();
    return proofPath ? { path: proofPath, filename: path.basename(proofPath) } : null;
  }
  if (!item || typeof item !== 'object') return null;
  const proofPath = String(item.path || item.proof_path || '').trim();
  if (!proofPath) return null;
  return {
    path: proofPath,
    filename: String(item.filename || item.proof_filename || path.basename(proofPath)).trim() || path.basename(proofPath),
  };
}

function getProofFiles(submission) {
  let files = [];
  if (submission && (submission.proof_files || submission.proofFiles)) {
    try {
      const parsed = JSON.parse(submission.proof_files || submission.proofFiles);
      if (Array.isArray(parsed)) files = parsed.map(normalizeProofFile).filter(Boolean);
    } catch (_) {
      files = [];
    }
  }

  if (files.length === 0 && submission && submission.proof_path) {
    files = [normalizeProofFile({ path: submission.proof_path, filename: submission.proof_filename })].filter(Boolean);
  }

  const seen = new Set();
  return files.filter(file => {
    const key = file.path.replace(/\\/g, '/');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serializeProofFiles(files) {
  return JSON.stringify((files || []).map(normalizeProofFile).filter(Boolean));
}

module.exports = { getProofFiles, serializeProofFiles };
