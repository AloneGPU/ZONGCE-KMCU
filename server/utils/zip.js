const fs = require('fs');
const { pipeline } = require('stream/promises');

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function crc32Update(crc, buffer) {
  let next = crc;
  for (let i = 0; i < buffer.length; i += 1) {
    next = crcTable[(next ^ buffer[i]) & 0xff] ^ (next >>> 8);
  }
  return next;
}

function crc32File(filePath) {
  return new Promise((resolve, reject) => {
    let crc = 0xffffffff;
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      crc = crc32Update(crc, chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve((crc ^ 0xffffffff) >>> 0));
  });
}

function writeBuffer(writable, buffer) {
  return new Promise((resolve, reject) => {
    const onError = err => {
      writable.off('drain', onDrain);
      reject(err);
    };
    const onDrain = () => {
      writable.off('error', onError);
      resolve();
    };
    writable.once('error', onError);
    if (writable.write(buffer)) {
      writable.off('error', onError);
      resolve();
    } else {
      writable.once('drain', onDrain);
    }
  });
}

function buildLocalHeader(entry) {
  const nameBuffer = Buffer.from(entry.name, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filenames
  localHeader.writeUInt16LE(0, 8); // store: images are already compressed
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(entry.crc, 14);
  localHeader.writeUInt32LE(entry.size, 18);
  localHeader.writeUInt32LE(entry.size, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);
  return { localHeader, nameBuffer };
}

function buildCentralHeader(entry) {
  const nameBuffer = Buffer.from(entry.name, 'utf8');
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(entry.crc, 16);
  centralHeader.writeUInt32LE(entry.size, 20);
  centralHeader.writeUInt32LE(entry.size, 24);
  centralHeader.writeUInt16LE(nameBuffer.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(entry.offset, 42);
  return [centralHeader, nameBuffer];
}

async function prepareZipEntries(files) {
  const entries = [];
  let offset = 0;

  for (const file of files) {
    const stat = await fs.promises.stat(file.path);
    const size = stat.size;
    if (size > 0xffffffff) {
      throw new Error('单个图片超过 ZIP32 支持大小，暂不支持导出');
    }
    const crc = await crc32File(file.path);
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const entry = { ...file, size, crc, offset };
    entries.push(entry);
    offset += 30 + nameBuffer.length + size;
    if (offset > 0xffffffff) {
      throw new Error('导出文件过大，暂不支持 ZIP64，请缩小筛选范围分批导出');
    }
  }

  return { entries, dataEndOffset: offset };
}

async function streamZipFiles(writable, files) {
  const { entries, dataEndOffset } = await prepareZipEntries(files);
  const central = [];

  for (const entry of entries) {
    const { localHeader, nameBuffer } = buildLocalHeader(entry);
    await writeBuffer(writable, localHeader);
    await writeBuffer(writable, nameBuffer);
    await pipeline(fs.createReadStream(entry.path), writable, { end: false });
    central.push(...buildCentralHeader(entry));
  }

  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  if (centralSize > 0xffffffff) {
    throw new Error('ZIP 中央目录过大，暂不支持 ZIP64，请缩小筛选范围分批导出');
  }

  for (const item of central) {
    await writeBuffer(writable, item);
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(dataEndOffset, 16);
  end.writeUInt16LE(0, 20);
  await writeBuffer(writable, end);
  writable.end();
}

module.exports = { streamZipFiles, crc32File };
