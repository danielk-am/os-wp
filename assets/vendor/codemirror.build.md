# Rebuilding `codemirror.js`

`assets/vendor/codemirror.js` is a single CodeMirror 6 bundle: state, view,
language, commands, search, autocomplete, the languages, and `basicSetup`, all
in ONE ESM file. Bundling everything into one file means there is exactly ONE
copy of `@codemirror/state`. The previous per-package vendored bundles each
inlined their own state, so cross-package `instanceof` checks failed at runtime
("multiple instances of @codemirror/state"). One bundle = one instance.

To rebuild (no build step lives in the repo, so do this in a scratch dir):

```sh
npm init -y
npm install codemirror @codemirror/state @codemirror/view @codemirror/language \
  @codemirror/commands @codemirror/search @codemirror/autocomplete @codemirror/lint \
  @codemirror/lang-markdown @codemirror/lang-javascript @codemirror/lang-python \
  @codemirror/lang-json @codemirror/lang-yaml @codemirror/lang-php \
  @codemirror/lang-css @codemirror/lang-html @codemirror/lang-sql \
  @codemirror/lang-xml @codemirror/legacy-modes esbuild
# Use the entry module below as index.js, then:
./node_modules/.bin/esbuild index.js --bundle --format=esm --minify \
  --legal-comments=none --outfile=codemirror.js
```

The entry module (`index.js`) re-exports the CM6 API the app imports and a
`languageFor(name)` helper that maps a CI language id to a CM6 language
extension (`php` uses `{ plain: true }` so tag-free php files still highlight).
Keep it in sync with the imports in `assets/ci-editors.js`. Its current content
is the canonical source; if you change the language list, update both.

The importmap (`inc/admin/class-context-app.php`) points `codemirror` and every
`@codemirror/*` specifier at this one file, so every import resolves to the
single instance.
