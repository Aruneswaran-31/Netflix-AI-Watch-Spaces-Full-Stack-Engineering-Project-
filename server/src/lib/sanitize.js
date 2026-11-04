'use strict';

/** Strip control characters, collapse runs of whitespace, trim. */
function cleanText(input, { maxLength = 1000 } = {}) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

module.exports = { cleanText };
