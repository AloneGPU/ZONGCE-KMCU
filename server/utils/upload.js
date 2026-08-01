const path = require('path');
const fs = require('fs');
const multer = require('multer');

const DEFAULT_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || DEFAULT_UPLOAD_ROOT);
if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

// 统一先存到 _incoming 临时目录，controller 中再移动
const INCOMING_DIR = path.join(UPLOAD_ROOT, '_incoming');
if (!fs.existsSync(INCOMING_DIR)) {
  fs.mkdirSync(INCOMING_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, INCOMING_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    const safeName = baseName.replace(/[^\w一-鿿-]/g, '_').substring(0, 50);
    cb(null, `${Date.now()}_${safeName}${ext}`);
  },
});

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif'];
const UPLOAD_MAX_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE, 10) || 10 * 1024 * 1024;

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return cb(null, false);
  }
  cb(null, true);
};

// magic number 校验函数（供 controller 在文件写入后调用）
function validateMagicNumber(filePath, declaredMime) {
  const magicMap = {
    'application/pdf': '25504446',
    'image/jpeg': 'ffd8',
    'image/png': '89504e47',
    'image/gif': '47494638',
    'application/msword': 'd0cf11e0',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '504b0304',
  };
  const expected = magicMap[declaredMime];
  if (!expected) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
    return bytesRead === 4 && buf.toString('hex').startsWith(expected);
  } finally {
    fs.closeSync(fd);
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: UPLOAD_MAX_SIZE } });

function sanitizeFilePart(value, fallback = '材料') {
  const safe = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '')
    .replace(/_+/g, '_')
    .substring(0, 80);
  return safe || fallback;
}

function uniqueFilename(targetDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let index = 1;
  while (fs.existsSync(path.join(targetDir, candidate))) {
    candidate = `${base}_${index}${ext}`;
    index += 1;
  }
  return candidate;
}

function sanitizeFilename(filename, fallback = '材料') {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const base = path.basename(String(filename || fallback), ext);
  return sanitizeFilePart(base, fallback) + ext;
}

// 将文件从临时目录移动到正式目录
function moveToFinalDir(tempFilename, yearName, studentCode, finalFilename) {
  const targetDir = path.join(UPLOAD_ROOT, String(yearName), String(studentCode));
  fs.mkdirSync(targetDir, { recursive: true });

  const src = path.join(INCOMING_DIR, tempFilename);
  const safeFilename = uniqueFilename(targetDir, sanitizeFilename(finalFilename, tempFilename));
  const dst = path.join(targetDir, safeFilename);
  fs.renameSync(src, dst);

  return { proofPath: `${yearName}/${studentCode}/${safeFilename}`, filename: safeFilename };
}

function resolveStoredFile(proofPath) {
  const relativePath = String(proofPath || '').replace(/[\\/]+/g, path.sep);
  const resolved = path.resolve(UPLOAD_ROOT, relativePath);
  if (!relativePath || (resolved !== UPLOAD_ROOT && !resolved.startsWith(`${UPLOAD_ROOT}${path.sep}`))) {
    throw new Error('非法的材料文件路径');
  }
  return resolved;
}

function deleteStoredFile(proofPath) {
  if (!proofPath) return false;
  const filePath = resolveStoredFile(proofPath);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = upload;
module.exports.moveToFinalDir = moveToFinalDir;
module.exports.validateMagicNumber = validateMagicNumber;
module.exports.sanitizeFilePart = sanitizeFilePart;
module.exports.sanitizeFilename = sanitizeFilename;
module.exports.getUploadRoot = () => UPLOAD_ROOT;
module.exports.resolveStoredFile = resolveStoredFile;
module.exports.deleteStoredFile = deleteStoredFile;
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;
module.exports.UPLOAD_MAX_SIZE = UPLOAD_MAX_SIZE;
