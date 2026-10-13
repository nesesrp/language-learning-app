# WordCards

A flashcard app for learning vocabulary with spaced repetition. 

## Features

- **Home page:** the entry point to every way of practising: Kelime (Vocabulary), Yazma (Writing), Dinleme (Listening), Konuşma (Speaking), Okuma (Reading), Podcast and Oyun (Game)
- **Practice modes:** use your own cards, from all decks or one deck. *Writing:* see the Turkish meaning, type the English word. *Fill in the blank* (a tab of Writing): see a sentence from the reading texts with the word left out and its Turkish meaning, type the missing word. The form the sentence needs is expected ("went" for *go*), but the dictionary form is accepted with a note. Example sentences exist for about 4,500 words of the ready-made decks, so cards without one are left out. *Listening:* hear the word (browser speech synthesis, no audio files) and either pick its meaning or type what you heard (dictation). Dictation has slow replay, a hint and an "I don't know" button, accepts words that sound the same (e.g. *their* for *there*), and after a wrong answer marks the extra and missing letters. Both listening modes list the missed words at the end of a round. *Speaking:* see a word and say it out loud; the browser's speech recognition checks whether it was understood. It is lenient about extra words ("an apple") and words that sound the same, and gives three tries per word, with a button to hear the word first. Speech recognition works in Chrome, Edge and Safari (Chrome and Edge need an internet connection, because the audio is recognized on their servers). *Game:* match words with their meanings against the clock. Practice doesn't change the spaced repetition schedule but counts towards the daily streak
- **Reading:** 189 news texts, each in three versions (Kolay, Orta, Zor) with an estimated CEFR level. Tap a word to see its meaning from the word list (inflected forms like "went" or "cities" are found too) and add it to the "Okuma Kelimeleri" deck. Words already in your decks are underlined. The text can be read aloud sentence by sentence, and finished texts are marked as read. See [Reading texts](#reading-texts)
- **Podcast:** 10 short episodes (A1–B2) in which two hosts, Sam and Alex, talk about everyday topics. They are read aloud with two different browser voices, so there are no audio files. The transcript starts hidden; its words can be tapped like on the reading page and added to the "Podcast Kelimeleri" deck. Playback can go back or forward a sentence, start from any line and run at 0.75x, 1x or 1.25x. Each episode ends with comprehension questions. The episodes are written for this app and live in `frontend/data/podcasts.json`
- **Decks:** create, rename and delete decks (e.g. "English Verbs", "Spanish Food")
- **CEFR levels:** every deck can have a level (A1, A2, B1, B2, C1, C2). The home page can be filtered by level
- **Ready-made decks:** the "Hazır" page has about 9,800 English → Turkish words in 230+ decks, split by level, then by topic (e.g. "Yiyecek ve İçecek") or by part of speech ("Fiiller 1", "Fiiller 2"…). Pick your level and add a deck, or all decks of that level, with one click. See [Word lists](#word-lists)
- **Cards:** add, edit and delete cards with a word on the front and its meaning on the back
- **Card search:** the "Desteler" page searches the words and meanings of all cards at once. It ignores case and accents, so "ogrenmek" finds "öğrenmek". Exact matches come first, and each result links to its deck
- **Study mode:** flip the card and answer "Bildim" (knew it) or "Bilemedim" (didn't know). Keyboard shortcuts: `Space` flips the card, `1` means "Bilemedim", `2` means "Bildim"
- **Spaced repetition:** uses the Leitner box system. A card you know comes back after 1, 3, 7, 16 and then 35 days. A card you miss goes back to the first box and shows up again later in the same session
- **Progress:** cards learned, daily streak, longest streak and activity for the last 14 days
- **Daily goal:** pick a daily target (10, 20, 30, 50 or 100 reviews) on the "İlerleme" page. Study answers, practice answers, finished reading texts and podcast episodes count towards it. The home page shows today's progress as a ring, and the 14-day chart marks the goal with a dashed line and colors the days that reached it green
- **Dark mode:** follows the system setting by default. The button in the top bar switches between Sistem, Açık (light) and Koyu (dark), and the choice is remembered on that device
- **Persistent data:** stored in the browser's `localStorage` for now
- **Backup:** the "İlerleme" page can download all decks, cards and progress as a JSON file and restore them from it (this replaces the current data). It reminds you if you haven't made a backup in 14 days

## Running the frontend

The frontend uses ES modules, so open it through a small local server instead of double-clicking the file:

```bash
cd frontend
python3 -m http.server 5173
# or: npx serve .
```

Then go to http://localhost:5173 in your browser.

## Project structure

```
frontend/
  index.html
  css/style.css
  js/app.js       # routing and views (UI)
  js/practice.js  # writing, fill in the blank, listening, dictation, speaking and matching game modes
  js/speech.js    # English pronunciation and speech recognition (Web Speech API)
  js/reading.js   # reading page: texts, reading aloud
  js/podcast.js   # podcast page: episodes, player, questions
  js/wordsheet.js # tap a word to see its meaning and add it to a deck
  js/lemmas.js    # dictionary forms of inflected words ("went" → "go")
  js/homophones.js  # words that sound the same, accepted in dictation
  js/theme.js     # light/dark theme toggle
  js/util.js      # shared helpers
  js/storage.js   # data layer (localStorage for now)
  js/srs.js       # spaced repetition algorithm
  js/stats.js     # streak and activity calculations
  js/presets.js   # CEFR levels; loads the ready-made decks
  data/wordlist.json  # ready-made decks (generated, see below)
  data/texts/         # reading texts (generated, see below)
  data/sentences.json # example sentences for fill in the blank (generated, see below)
  data/podcasts.json  # podcast episodes (hand-written)
scripts/
  build-wordlist.mjs  # builds frontend/data/wordlist.json
  build-sentences.mjs # builds frontend/data/sentences.json
  build-texts.mjs     # builds frontend/data/texts/
  overrides.json      # hand-made translation fixes
```

## Word lists

`frontend/data/wordlist.json` is generated, so don't edit it by hand. To rebuild it:

```bash
node scripts/build-wordlist.mjs
```

The first run downloads the sources into `scripts/.cache/` (git-ignored). The largest one, the English Wiktionary extract (~520 MB), is only streamed and filtered, never stored in full. Later runs use the cache and take a few seconds.

How it works:

1. **Words and levels** come from the CEFR-J Vocabulary Profile (A1–B2) and the Octanove Vocabulary Profile (C1–C2).
2. **Turkish translations** come from two Wiktionary extracts: translation tables in the English Wiktionary and Turkish glosses of English words in the Turkish Wiktionary. A translation found in both ranks first. Rare or archaic Turkish words are dropped when a common one exists (checked against a Turkish frequency list), and a blocklist removes slang and slurs that appear as minor senses.
3. **Fixes:** `scripts/overrides.json` maps `"word|pos"` to a translation and always wins. Use it to correct a bad translation or to fill a missing one. An empty string drops the word. Words left without a translation are listed in `scripts/.cache/untranslated.txt` after each run.
4. **Decks:** words with a CEFR-J topic form topic decks; the rest are grouped by part of speech. Decks hold at most 50 words, most frequent words first (by an English frequency list).

### Sources and licenses

| Data | Source | License |
| ---- | ------ | ------- |
| A1–B2 words and levels | [CEFR-J Vocabulary Profile 1.5](https://github.com/openlanguageprofiles/olp-en-cefrj), Tono Laboratory, TUFS | Free for research and commercial use with citation |
| C1–C2 words and levels | [Octanove Vocabulary Profile C1/C2 1.0](https://github.com/openlanguageprofiles/olp-en-cefrj), Octanove Labs | CC BY-SA 4.0 |
| Turkish translations | [Wiktionary](https://www.wiktionary.org/) via [kaikki.org](https://kaikki.org/) (Wiktextract) | CC BY-SA 4.0 |
| Word frequencies | [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles) | CC BY-SA 4.0 |

Because of the share-alike sources, `frontend/data/wordlist.json` is distributed under **CC BY-SA 4.0**. The rest of the code is not affected.

CEFR-J citation: The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http://www.cefr-j.org/download.html. The app also credits the sources on the "Hazır" page.

## Backend

**Stack:** Node.js + Express + SQLite

- **Node.js:** the backend uses the same language as the frontend (JavaScript), and imports the frontend's `srs.js`, `stats.js` and the CEFR levels from `presets.js` as they are.
- **Express:** a small, widely used web framework for building a REST API with little code.
- **SQLite:** a single-file database (via `better-sqlite3`), so there is no database server to install or run. If the app grows, it can be swapped for PostgreSQL later without changing the API.

The frontend doesn't use the backend yet; it still keeps its data in `localStorage` (see *Frontend migration* below).

### Running the backend

Needs Node.js 22.7 or newer.

```bash
cd backend
npm install
npm start      # http://localhost:3000, serves the API and the frontend
npm test       # API tests, each with a fresh in-memory database
```

The data is stored in `backend/data/wordcards.db` (not committed). `PORT` and `DB_PATH` environment variables change the port and the database file. The schema is versioned (`PRAGMA user_version`) and an older database file is upgraded when the server starts.

### Accounts

Every user has their own decks, cards, activity and settings. Users register with an email and a password (at least 8 characters), and every `/api` endpoint outside `/api/auth` needs a login; without one it answers `401`. Another user's deck or card answers `404`, the same as a missing one.

- **Passwords** are hashed with scrypt (`node:crypto`), with a random salt per user.
- **Sessions** last 30 days and are kept in an `HttpOnly`, `SameSite=Lax` cookie (`wordcards_session`). The database only stores a SHA-256 hash of each session token. Changing the password logs out every other device.
- **Data from before accounts** belongs to nobody after the upgrade; the first account to register gets it.
- **Deleting an account** deletes all of its data.

### Structure

```
backend/
  package.json
  src/
    server.js       # starts the server (PORT, DB_PATH)
    app.js          # Express app: API under /api, frontend as static files
    db.js           # SQLite connection, schema migrations and row mapping
    auth.js         # password hashing, sessions, login check
    validate.js     # request validation and HTTP errors
    routes/
      auth.js       # register, login, logout, password, account deletion
      decks.js      # decks, cards of a deck, ready-made deck import
      cards.js      # editing cards and study answers
      stats.js      # activity and streaks
      settings.js
      backup.js
  test/
    api.test.js
```

### API

Requests and responses are JSON, with the same objects the frontend stores (`{ id, name, level, createdAt }` for decks, `{ id, deckId, front, back, box, due, … }` for cards). Errors come back as `{ "error": "…" }` with a Turkish message that can be shown to the user.

| Method | Endpoint                 | Description                          |
| ------ | ------------------------ | ------------------------------------ |
| POST   | `/api/auth/register`     | Create an account and log in (`{ email, password }`) |
| POST   | `/api/auth/login`        | Log in (`{ email, password }`)       |
| POST   | `/api/auth/logout`       | Log out                              |
| GET    | `/api/auth/me`           | The logged-in user (`{ id, email, createdAt }`) |
| POST   | `/api/auth/password`     | Change the password (`{ currentPassword, newPassword }`) |
| DELETE | `/api/auth/me`           | Delete the account and all its data (`{ password }`) |
| GET    | `/api/decks`             | List decks, newest first             |
| POST   | `/api/decks`             | Create a deck (`{ name, level? }`)   |
| GET    | `/api/decks/:id`         | Get a deck                           |
| PATCH  | `/api/decks/:id`         | Rename a deck or change its level    |
| DELETE | `/api/decks/:id`         | Delete a deck and its cards          |
| GET    | `/api/decks/:id/cards`   | List the cards in a deck             |
| POST   | `/api/decks/:id/cards`   | Add a card (`{ front, back }`)       |
| POST   | `/api/presets/import`    | Add ready-made decks with their cards (`{ presets: [...] }`) |
| GET    | `/api/cards`             | List all cards                       |
| PATCH  | `/api/cards/:id`         | Edit a card                          |
| DELETE | `/api/cards/:id`         | Delete a card                        |
| POST   | `/api/cards/:id/review`  | Save a study answer (`{ knew: true }`); counts towards today's activity |
| POST   | `/api/activity`          | Count practice, reading or podcast towards today (`{ count? }`) |
| GET    | `/api/stats`             | Activity per day, today's count, current and longest streak |
| GET    | `/api/settings`          | Get all settings                     |
| PATCH  | `/api/settings`          | Merge fields into the settings       |
| GET    | `/api/backup`            | Download the user's data (same format as the frontend's backup file) |
| POST   | `/api/backup`            | Replace the user's data with a backup |

**Frontend migration:** `frontend/js/storage.js` needs to change, plus a login/register screen. The storage functions are already async, so their bodies will be replaced with `fetch('/api/...')` calls and the rest of the UI code stays as it is. Existing data can be moved over with a backup file.

**Later:** limiting failed login attempts, password reset by email, and importing/exporting single decks.

## Reading texts

`frontend/data/texts/` is generated from the [OneStopEnglish corpus](https://github.com/nishkalavallabhi/OneStopEnglishCorpus) (Vajjala & Lučić, 2018), which is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The generated texts are under the same license. To rebuild them (run `build-wordlist.mjs` first, as its downloads are reused):

```bash
node scripts/build-texts.mjs
```

What the script does:

- **Cleans the text:** the source files are in Windows-1252 or Mac Roman, not UTF-8, and were copied from PDFs, so line breaks are joined and the lost ligatures are put back ("the  rst" → "the first", "dif cult" → "difficult") using the word lists as a dictionary
- **Estimates a CEFR level** for each version: the lowest level whose words make up 97% of the words that are in the CEFR-J / Octanove lists. Names and topic words that aren't in the lists are left out. The "easy" versions come out mostly B1, the "hard" ones mostly B2
- **Writes** `index.json` (titles, summaries, levels, word counts) and one file per text, so the reading page only loads what is being read


### Example sentences

`frontend/data/sentences.json` holds the example sentences of the fill-in-the-blank mode. They are taken from the reading texts, so they are under CC BY-SA 4.0 as well. To rebuild it after the word list or the texts change:

```bash
node scripts/build-sentences.mjs
```

The script keeps sentences of 6–22 words, finds the words of the ready-made decks in them the same way the reading page does ("went" → *go*, but "letter" stays *letter*), skips names ("Apple" the company is not *apple*) and keeps the three shortest sentences per word, preferring the easier text versions. It stores where the word is in each sentence, so the app only has to hide that part.
