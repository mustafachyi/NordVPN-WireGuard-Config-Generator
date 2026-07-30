const MAX_UINT16 = 0xffff
const MAX_UINT32 = 0xffffffff
const ZIP_VERSION = 20
const UTF8_FLAG = 0x0800
const STORE_METHOD = 0
const DOS_TIME = 0
const DOS_DATE = 0x0021
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_RECORD_SIGNATURE = 0x06054b50
const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const END_RECORD_SIZE = 22
const CRC_TABLE = new Uint32Array(256)

for (let index = 0; index < CRC_TABLE.length; index++) {
  let remainder = index

  for (let bit = 0; bit < 8; bit++) {
    remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1
  }

  CRC_TABLE[index] = remainder >>> 0
}

function computeCRC32(data) {
  let crc = MAX_UINT32

  for (let index = 0; index < data.length; index++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[index]) & 0xff]
  }

  return (crc ^ MAX_UINT32) >>> 0
}

export function createZipArchive(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Archive requires at least one entry')
  }

  if (entries.length > MAX_UINT16) {
    throw new Error('Archive contains too many entries')
  }

  const encoder = new TextEncoder()
  const entryNames = new Set()
  const metadata = entries.map(entry => {
    if (!entry || typeof entry.name !== 'string' || !(entry.data instanceof Uint8Array)) {
      throw new Error('Invalid archive entry')
    }

    if (entryNames.has(entry.name)) {
      throw new Error('Archive contains duplicate entry names')
    }

    entryNames.add(entry.name)

    const nameBytes = encoder.encode(entry.name)
    if (nameBytes.length === 0 || nameBytes.length > MAX_UINT16) {
      throw new Error('Invalid archive entry name')
    }

    if (entry.data.length > MAX_UINT32) {
      throw new Error('Archive entry is too large')
    }

    return {
      nameBytes,
      crc: computeCRC32(entry.data),
      size: entry.data.length,
    }
  })

  let localHeaderOffset = 0
  let centralDirectorySize = 0
  const offsets = []

  for (const meta of metadata) {
    offsets.push(localHeaderOffset)
    localHeaderOffset += LOCAL_HEADER_SIZE + meta.nameBytes.length + meta.size
    centralDirectorySize += CENTRAL_HEADER_SIZE + meta.nameBytes.length

    if (localHeaderOffset > MAX_UINT32 || centralDirectorySize > MAX_UINT32) {
      throw new Error('Archive exceeds ZIP32 limits')
    }
  }

  const totalSize = localHeaderOffset + centralDirectorySize + END_RECORD_SIZE
  if (totalSize > MAX_UINT32) {
    throw new Error('Archive exceeds ZIP32 limits')
  }

  const buffer = new Uint8Array(totalSize)
  const view = new DataView(buffer.buffer)
  let cursor = 0

  const writeUint16 = value => {
    view.setUint16(cursor, value, true)
    cursor += 2
  }

  const writeUint32 = value => {
    view.setUint32(cursor, value, true)
    cursor += 4
  }

  const writeBytes = value => {
    buffer.set(value, cursor)
    cursor += value.length
  }

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const meta = metadata[index]

    writeUint32(LOCAL_HEADER_SIGNATURE)
    writeUint16(ZIP_VERSION)
    writeUint16(UTF8_FLAG)
    writeUint16(STORE_METHOD)
    writeUint16(DOS_TIME)
    writeUint16(DOS_DATE)
    writeUint32(meta.crc)
    writeUint32(meta.size)
    writeUint32(meta.size)
    writeUint16(meta.nameBytes.length)
    writeUint16(0)
    writeBytes(meta.nameBytes)
    writeBytes(entry.data)
  }

  for (let index = 0; index < entries.length; index++) {
    const meta = metadata[index]

    writeUint32(CENTRAL_HEADER_SIGNATURE)
    writeUint16(ZIP_VERSION)
    writeUint16(ZIP_VERSION)
    writeUint16(UTF8_FLAG)
    writeUint16(STORE_METHOD)
    writeUint16(DOS_TIME)
    writeUint16(DOS_DATE)
    writeUint32(meta.crc)
    writeUint32(meta.size)
    writeUint32(meta.size)
    writeUint16(meta.nameBytes.length)
    writeUint16(0)
    writeUint16(0)
    writeUint16(0)
    writeUint16(0)
    writeUint32(0)
    writeUint32(offsets[index])
    writeBytes(meta.nameBytes)
  }

  writeUint32(END_RECORD_SIGNATURE)
  writeUint16(0)
  writeUint16(0)
  writeUint16(entries.length)
  writeUint16(entries.length)
  writeUint32(centralDirectorySize)
  writeUint32(localHeaderOffset)
  writeUint16(0)

  return buffer
}