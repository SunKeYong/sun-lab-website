// Read bigBed metadata and one indexed data block; never decode it as BED text.
class LocalBigBedError extends Error {}

export async function inspectLocalBigBed(file, chromosomes, assembly) {
  const filename = String(file?.name || 'bigBed file');
  const fail = message => { throw new LocalBigBedError(`${filename}: ${message}`); };
  const corrupt = message => fail(`Invalid or incomplete bigBed file. ${message}`);
  if (!/\.(bb|bigbed)$/i.test(filename)) fail('Choose a .bb or .bigBed file.');
  const fileSize = file.size;
  if (!Number.isSafeInteger(fileSize) || fileSize < 64) corrupt('The binary header is missing or truncated.');
  const read = async (offset, length) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > fileSize - length) {
      corrupt('An internal data or index range falls outside the file.');
    }
    const buffer = await file.slice(offset, offset + length).arrayBuffer();
    if (buffer.byteLength !== length) corrupt('An internal data or index range is truncated.');
    return new DataView(buffer);
  };
  try {
    const header = await read(0, 64), magic = 0x8789f2eb;
    const littleEndian = header.getUint32(0, true) === magic;
    if (!littleEndian && header.getUint32(0, false) !== magic) corrupt('The file signature is not bigBed.');
    const u64 = (view, offset) => {
      const value = view.getBigUint64(offset, littleEndian);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) corrupt('An internal offset or count is too large to read accurately.');
      return Number(value);
    };
    const chromTreeOffset = u64(header, 8), fullDataOffset = u64(header, 16), fullIndexOffset = u64(header, 24);
    const fieldCount = header.getUint16(32, littleEndian), definedFieldCount = header.getUint16(34, littleEndian);
    const uncompressBufferSize = header.getUint32(52, littleEndian);
    if (definedFieldCount < 3 || definedFieldCount > 12 || fieldCount < definedFieldCount) corrupt('The BED field counts in the header are invalid.');
    if (chromTreeOffset < 64 || fullDataOffset < 64 || fullIndexOffset < 64) corrupt('The file has an invalid chromosome, data or interval-index offset.');
    const chromHeader = await read(chromTreeOffset, 32);
    if (chromHeader.getUint32(0, littleEndian) !== 0x78ca8c91) corrupt('The chromosome index signature is invalid.');
    const blockSize = chromHeader.getUint32(4, littleEndian), keySize = chromHeader.getUint32(8, littleEndian), valueSize = chromHeader.getUint32(12, littleEndian);
    const expectedChromosomes = u64(chromHeader, 16);
    if (!blockSize || !keySize || valueSize !== 8 || !expectedChromosomes || expectedChromosomes > Math.floor(fileSize / (keySize + valueSize))) {
      corrupt('The chromosome index structure is invalid.');
    }
    const namesById = new Map(), seenNames = new Set(), visitedChromNodes = new Set();
    const decoder = new TextDecoder('utf-8', {fatal:true});
    // A stack avoids recursion limits for malicious or unusually deep indices.
    const pendingChromNodes = [chromTreeOffset + 32];
    while (pendingChromNodes.length) {
      const offset = pendingChromNodes.pop();
      if (visitedChromNodes.has(offset)) corrupt('The chromosome index contains a cycle or repeated node.');
      visitedChromNodes.add(offset);
      const nodeHeader = await read(offset, 4), leaf = nodeHeader.getUint8(0), count = nodeHeader.getUint16(2, littleEndian);
      if ((leaf !== 0 && leaf !== 1) || !count || count > blockSize) corrupt('A chromosome-index node is invalid.');
      const stride = keySize + 8, node = await read(offset + 4, count * stride);
      for (let index = 0; index < count; index++) {
        const position = index * stride;
        if (!leaf) { pendingChromNodes.push(u64(node, position + keySize)); continue; }
        const bytes = new Uint8Array(node.buffer, node.byteOffset + position, keySize);
        const terminator = bytes.indexOf(0), name = decoder.decode(terminator === -1 ? bytes : bytes.subarray(0, terminator));
        const id = node.getUint32(position + keySize, littleEndian), length = node.getUint32(position + keySize + 4, littleEndian);
        if (!name || !length || seenNames.has(name) || namesById.has(id)) corrupt('A chromosome-index entry is empty, duplicated or invalid.');
        if (!Object.prototype.hasOwnProperty.call(chromosomes, name)) {
          fail(`Sequence "${name}" is not in the ${assembly} reference. Select a bigBed built for ${assembly}; files are not lifted over automatically.`);
        }
        if (Number(chromosomes[name]) !== length) {
          fail(`Reference mismatch: ${name} has ${length.toLocaleString()} bases in this file, but ${assembly} expects ${Number(chromosomes[name]).toLocaleString()}. Select a bigBed built for ${assembly}; files are not lifted over automatically.`);
        }
        seenNames.add(name); namesById.set(id, name);
        if (seenNames.size > expectedChromosomes) corrupt('The chromosome count does not match the index header.');
      }
    }
    if (seenNames.size !== expectedChromosomes) corrupt('The chromosome count does not match the index header.');
    const countView = await read(fullDataOffset, 8), intervalCount = u64(countView, 0);
    if (!intervalCount) fail('No intervals found in this bigBed file.');
    const indexHeader = await read(fullIndexOffset, 48);
    if (indexHeader.getUint32(0, littleEndian) !== 0x2468ace0 || !indexHeader.getUint32(4, littleEndian) || !u64(indexHeader, 8)) {
      corrupt('The interval index header is invalid.');
    }
    const intervalBlockSize = indexHeader.getUint32(4, littleEndian), visitedIntervalNodes = new Set();
    let nodeOffset = fullIndexOffset + 48, dataOffset, dataSize;
    while (true) {
      if (visitedIntervalNodes.has(nodeOffset)) corrupt('The interval index contains a cycle.');
      visitedIntervalNodes.add(nodeOffset);
      const nodeHeader = await read(nodeOffset, 4), leaf = nodeHeader.getUint8(0), count = nodeHeader.getUint16(2, littleEndian);
      if ((leaf !== 0 && leaf !== 1) || !count || count > intervalBlockSize) corrupt('An interval-index node is invalid.');
      const stride = leaf ? 32 : 24;
      // Validate the complete node range, but load only its first entry.
      if (nodeOffset + 4 > fileSize - count * stride) corrupt('An interval-index node is truncated.');
      const entry = await read(nodeOffset + 4, stride);
      const childOffset = u64(entry, 16);
      if (leaf) { dataOffset = childOffset; dataSize = u64(entry, 24); break; }
      nodeOffset = childOffset;
    }
    if (!dataSize) corrupt('The first indexed data block is empty.');
    const data = await read(dataOffset, dataSize);
    let block = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (uncompressBufferSize > 0) {
      if (typeof DecompressionStream === 'undefined') fail('This browser cannot decompress bigBed data. Open the page in a current browser.');
      const reader = new Blob([block]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
      const chunks = []; let length = 0;
      try {
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > uncompressBufferSize) corrupt('A decompressed data block exceeds its declared size.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      block = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { block.set(chunk, offset); offset += chunk.byteLength; }
    }
    if (block.byteLength < 13 || block.indexOf(0, 12) === -1) corrupt('The first interval record is truncated.');
    const first = new DataView(block.buffer, block.byteOffset, block.byteLength);
    const chr = namesById.get(first.getUint32(0, littleEndian)), start = first.getUint32(4, littleEndian), end = first.getUint32(8, littleEndian);
    if (!chr || end <= start || end > Number(chromosomes[chr])) corrupt('The first interval has invalid reference coordinates.');
    return {
      format:'bigbed',
      name:filename.replace(/\.(bb|bigbed)$/i, ''),
      intervalCount,
      firstLocus:`${chr}:${Math.max(1, start + 1 - 1000)}-${Math.min(Number(chromosomes[chr]), end + 1000)}`
    };
  } catch (error) {
    if (error instanceof LocalBigBedError) throw error;
    fail('Unable to read the bigBed metadata or first data block. Check that the file is complete and uses the bigBed binary format.');
  }
}
