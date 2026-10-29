import { inspectLocalBigBed } from './local-bigbed.js?v=20261029-bigbed';

// Validate local interval files before handing the original File to IGV.js.
// Reads a line at a time so validation does not retain the complete BED text.
export function localBedFormat(name) {
  if (/\.(bb|bigbed)$/i.test(String(name))) return 'bigbed';
  const match = String(name).match(/\.(bed|narrowpeak|broadpeak)(?:\.gz)?$/i);
  return match?.[1].toLowerCase();
}

class LocalBedError extends Error {}

export async function inspectLocalBed(file, chromosomes, assembly) {
  const format = localBedFormat(file?.name);
  if (!format) throw new LocalBedError('Choose a .bed, .bb, .bigBed, .narrowPeak or .broadPeak file; BED and peak text files may be compressed as .gz.');
  if (format === 'bigbed') return inspectLocalBigBed(file, chromosomes, assembly);
  const filename = String(file.name);
  const fail = (line, message) => {
    throw new LocalBedError(`${filename}, line ${line.toLocaleString()}: ${message}`);
  };
  let stream = file.stream();
  if (/\.gz$/i.test(filename)) {
    if (typeof DecompressionStream === 'undefined') {
      throw new LocalBedError('This browser cannot read gzip files. Decompress the file locally and select the uncompressed BED or peak file.');
    }
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.pipeThrough(new TextDecoderStream('utf-8', {fatal: true})).getReader();
  let pending = '', lineNumber = 0, intervalCount = 0, firstLocus;
  const inspectLine = raw => {
    lineNumber++;
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^(track|browser)(?:\s|$)/i.test(line)) return;
    const fields = line.split(/\s+/);
    const required = format === 'narrowpeak' ? 10 : format === 'broadpeak' ? 9 : 3;
    if (fields.length < required) {
      fail(lineNumber, `${format === 'bed' ? 'BED' : format === 'narrowpeak' ? 'narrowPeak' : 'broadPeak'} requires at least ${required} columns; found ${fields.length}.`);
    }
    const [chr, startText, endText] = fields;
    if (!Object.prototype.hasOwnProperty.call(chromosomes, chr)) {
      fail(lineNumber, `Sequence "${chr}" is not in the ${assembly} reference. Use this reference's sequence names and coordinates; files are not lifted over automatically.`);
    }
    if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText)) {
      fail(lineNumber, 'BED start and end must be non-negative integers (zero-based, half-open coordinates).');
    }
    const start = Number(startText), end = Number(endText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      fail(lineNumber, 'BED start and end are too large to read accurately. Check the coordinate columns.');
    }
    if (end <= start) fail(lineNumber, 'The end coordinate must be greater than the start coordinate.');
    if (end > chromosomes[chr]) {
      fail(lineNumber, `Interval ${chr}:${startText}-${endText} exceeds the ${assembly} sequence length (${Number(chromosomes[chr]).toLocaleString()} bases). Check the reference assembly.`);
    }
    // Give one-base and short peaks enough context for the browser search.
    // Only the suggested viewport changes; original BED coordinates stay intact.
    firstLocus ??= `${chr}:${Math.max(1, start + 1 - 1000)}-${Math.min(Number(chromosomes[chr]), end + 1000)}`;
    intervalCount++;
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      pending += value;
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        inspectLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }
    if (pending.length) inspectLine(pending);
    if (!intervalCount) throw new LocalBedError(`${filename}: No intervals found. The file must contain at least one BED or peak interval after any header lines.`);
  } catch (error) {
    if (error instanceof LocalBedError) throw error;
    throw new LocalBedError(`${filename}: Unable to read the file near line ${(lineNumber + 1).toLocaleString()}. Check that it contains UTF-8 text${/\.gz$/i.test(filename) ? ' and is a valid, complete gzip file' : ''}.`);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return {
    format,
    name: filename.replace(/\.gz$/i, '').replace(/\.(bed|narrowpeak|broadpeak)$/i, ''),
    intervalCount,
    firstLocus
  };
}
