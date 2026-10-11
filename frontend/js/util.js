// Small helpers shared by the views.

// Safely inserts user-entered text into HTML.
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Lowercases text and drops accents so a search for "ogrenmek" finds "öğrenmek"
// and "i" finds both "ı" and "İ". Each character maps to exactly one character,
// so a match index in the folded text is also valid in the original.
export const fold = (s) =>
  Array.from(String(s), (c) => {
    if (c === 'ı' || c === 'İ') return 'i';
    return c.length > 1 ? c : c.normalize('NFD')[0].toLowerCase();
  }).join('');
