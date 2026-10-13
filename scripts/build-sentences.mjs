// Builds frontend/data/sentences.json: example sentences for the words of the
// ready-made decks, taken from the reading texts. The fill-in-the-blank
// practice mode hides the word in one of them.
//
//   node scripts/build-sentences.mjs
//
// Needs frontend/data/wordlist.json and frontend/data/texts/ (run
// build-wordlist.mjs and build-texts.mjs first). The sentences come from the
// OneStopEnglish corpus, so the output is under CC BY-SA 4.0 as well.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lemmas } from '../frontend/js/lemmas.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'data');
const TEXTS = path.join(DATA, 'texts');

// Easier versions first, so their sentences are preferred.
const VERSIONS = ['ele', 'int', 'adv'];
const PER_WORD = 3;
const MIN_WORDS = 6;
const MAX_WORDS = 22;

// Letters of any alphabet, so "Úranía" stays one word instead of hiding "ran".
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;
const LABEL = /\s*\([^)]*\)\s*$/;
const key = (s) => s.toLocaleLowerCase('en').replace(/’/g, "'").replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every word and phrase of the ready-made decks ("airplane / aeroplane" gives both).
const wordlist = JSON.parse(fs.readFileSync(path.join(DATA, 'wordlist.json'), 'utf8'));
const words = new Set();
for (const deck of wordlist.decks) {
  for (const [front] of deck.words) {
    for (const variant of front.replace(LABEL, '').split('/')) {
      if (key(variant)) words.add(key(variant));
    }
  }
}
const phrases = [...words]
  .filter((w) => w.includes(' '))
  .map((w) => [w, new RegExp(`(?<![\\p{L}'’])${w.split(' ').map(escapeRe).join('\\s+')}(?![\\p{L}'’])`, 'iu')]);

// Splits a paragraph into sentences at . ! ? followed by a capital letter or a
// quote, and drops a quote mark whose pair ended up in another sentence.
function sentencesOf(paragraph) {
  return paragraph.split(/(?<=[.!?][”"’]?)\s+(?=[“"‘A-Z])/).map((s) => {
    s = s.trim();
    if (s.startsWith('“') && !s.includes('”')) s = s.slice(1);
    if (s.endsWith('”') && !s.includes('“')) s = s.slice(0, -1);
    return s;
  });
}

// The same dictionary form the reading page finds for a word: the first of its
// possible forms that is in the word list. So "letter" stays "letter" and isn't
// taken for "let", while "went" becomes "go".
// A contraction like "let's" is only taken as itself, as hiding it for "let"
// would leave half a word to guess.
const formOf = (token) =>
  /['’]/.test(token) ? (words.has(key(token)) ? key(token) : undefined) : lemmas(token).find((f) => words.has(f));

// Reads every usable sentence once, easier versions first.
const { source, texts } = JSON.parse(fs.readFileSync(path.join(TEXTS, 'index.json'), 'utf8'));
const all = [];
const seen = new Set();
// How often each word is written in lowercase, and capitalized inside a
// sentence: "Apple" is mostly a name, so it isn't taken for "apple".
const lowercase = new Map();
const capitalized = new Map();
const count = (map, w) => map.set(w, (map.get(w) ?? 0) + 1);
for (const version of VERSIONS) {
  for (const { id } of texts) {
    const text = JSON.parse(fs.readFileSync(path.join(TEXTS, `${id}.json`), 'utf8'));
    for (const paragraph of text.versions[version]?.paragraphs ?? []) {
      for (const sentence of sentencesOf(paragraph)) {
        const tokens = [...sentence.matchAll(WORD)];
        tokens.forEach((m, i) => {
          if (/^\p{Ll}/u.test(m[0])) count(lowercase, key(m[0]));
          else if (i > 0) count(capitalized, key(m[0]));
        });
        if (tokens.length < MIN_WORDS || tokens.length > MAX_WORDS || seen.has(sentence)) continue;
        // Headlines, lists and quotes cut in half make poor examples.
        if (!/^[“"‘A-Z]/.test(sentence) || !/[.!?][”"’]?$/.test(sentence)) continue;
        seen.add(sentence);
        all.push({ sentence, tokens });
      }
    }
  }
}

const isName = (token, i) =>
  /^\p{Lu}/u.test(token) && (i > 0 || (capitalized.get(key(token)) ?? 0) >= (lowercase.get(key(token)) ?? 0));

// word → [{ sentence, start, end }]: where the word is in each sentence it appears in.
const candidates = new Map();
for (const { sentence, tokens } of all) {
  const found = new Map();
  tokens.forEach((m, i) => {
    const w = !isName(m[0], i) && formOf(m[0]);
    if (w && !found.has(w)) found.set(w, [m.index, m.index + m[0].length]);
  });
  for (const [p, re] of phrases) {
    const m = sentence.match(re);
    if (m && !isName(m[0], m.index === tokens[0].index ? 0 : 1)) found.set(p, [m.index, m.index + m[0].length]);
  }
  for (const [w, [start, end]] of found) {
    if (!candidates.has(w)) candidates.set(w, []);
    candidates.get(w).push({ sentence, start, end });
  }
}

// Shorter sentences are easier to take in, so they are kept first. Each word
// maps to [sentence number, start, end] of the text to hide.
const sentences = [];
const ids = new Map();
const index = {};
for (const w of [...candidates.keys()].sort()) {
  index[w] = candidates.get(w)
    .map((c, order) => ({ ...c, order }))
    .sort((a, b) => a.sentence.length - b.sentence.length || a.order - b.order)
    .slice(0, PER_WORD)
    .map(({ sentence, start, end }) => {
      if (!ids.has(sentence)) ids.set(sentence, sentences.push(sentence) - 1);
      return [ids.get(sentence), start, end];
    });
}

fs.writeFileSync(path.join(DATA, 'sentences.json'), JSON.stringify({ source, sentences, words: index }));
console.log(`${Object.keys(index).length} of ${words.size} words have sentences (${sentences.length} sentences)`);
