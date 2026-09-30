# Move proof

Proves for one refactoring step that code was **only moved** and nothing else was changed.
It compares an old state with a new state on the syntax tree of TypeScript and with the type
checker. Stage 1 knows two forms:

- **Form 0, verbatim move.** Declarations of the module level (constant, function, class,
  `interface`, `type`, `enum`) move unchanged into a target file.
- **Form k, method with context.** A method of a class becomes a function of a target file with
  the context as first parameter (`k`). A forwarder stays in the class.

Guiding sentence: **better a false red than a false green.** What the tool cannot prove is a
finding. The user releases it in the manifest, with a reason, and the release is printed.

## Call

```bash
# on the build host a run on a real file is a heavy run: it builds two TypeScript programs
tools/sperre.sh build -- node_modules/.bin/tsx tools/verschiebung/verschiebung.ts <manifest.json> [--json]
```

Exit 0: proof given. Exit 1: at least one finding. Exit 2: call or manifest wrong.

There are no switches that influence the proof. Everything stands in the manifest, and the
manifest is printed into the output together with the version of the tool and the full hashes of
both states.

## Manifest

```json
{
  "version": 1,
  "alt": "git:de09eeb2",
  "neu": "git:b4dad1d0",
  "quelle": "client/src/entities/EntityManager.ts",
  "klasse": "EntityManager",
  "ziele": [
    { "datei": "client/src/entities/konstanten.ts", "woertlich": ["COLLIDER_RANGE", "zellenSchluessel"] },
    {
      "datei": "client/src/entities/raumIndex.ts",
      "methoden": ["indexSetzen", "indexEntfernen"],
      "kontext": { "parameter": "k", "typ": "RaumIndexKontext" }
    }
  ],
  "einstiege": ["client/src/main.ts"],
  "freigaben": [{ "schluessel": "laden:SHOW_COLLIDERS", "begruendung": "Reads the address of the page, not of the file; ..." }]
}
```

| Key | Meaning |
|---|---|
| `alt` | the old state, `git:<ref>`. Read from the object store, the working tree is not touched. |
| `neu` | the new state, `git:<ref>` or `arbeitsbaum` (tracked and untracked files of the working tree) |
| `quelle` | the source file, relative to the repository root |
| `klasse` | the class whose methods move (form k only) |
| `ziele[].datei` | a target file. In stage 1 a target file is a new file. |
| `ziele[].woertlich` | names of module level declarations that move verbatim (form 0) |
| `ziele[].methoden` | names of methods that become functions (form k) |
| `ziele[].kontext` | name of the context parameter (default `k`) and of the context type |
| `einstiege` | entry files from which the order of evaluation is compared (rule B10) |
| `freigaben` | releases, each with `schluessel` and `begruendung` (at least 20 visible characters) |

An unknown key, a release without a reason, a release key of an unknown kind, a name listed twice:
exit 2. A name that does not occur in the source, a release that releases nothing: a finding, exit 1.

## Rules

| Id | Promise |
|---|---|
| B1 | Complete: every statement of the old source file and every member of the old class exists exactly once in the new state; every statement of the rest and of the target files comes from the old state or is glue. |
| B2 | Rest byte-identical: every unmoved statement and member, with the lines before it, in the same order. |
| B3 | Tree equal: for every moved declaration the old tree with the form applied equals the new tree, node by node, with every token. Form 0 is byte-identical in addition. |
| B4 | Second line: the JavaScript TypeScript generates from the expected and from the found declaration is equal. Independent code. |
| B5 | Glue: outside the moved and unchanged parts only imports, re-exports, export lists, forwarders in the declared form, the context type, a header comment per target file and the loosened modifiers (a member the context type names may lose `private` or `protected`, a parameter property of the constructor too). |
| B6 | Comments: equal in moved declarations (form k: indentation may drop). Directive comments only where they stood. A forwarder carries no comment. |
| B7 | Binding: every identifier of the whole old source file points to the same declaration in the new state. Two programs, type checker. |
| B8 | Location: `import.meta`, `new URL` with a relative path, `import('./x')`, `require('./x')`, `__dirname`, `__filename`, `fileURLToPath`, `new Worker` in a moved declaration are findings. Release per place. |
| B9 | Loading: a moved declaration whose initial value acts while its module loads is a finding (release `laden:<name>`), and so is a read of a moved name by a statement of the rest that runs while loading, in front of its old place, directly or through a function it calls (release `lesen:<name>`): the old order failed or saw an unset value there. |
| B10 | Order of evaluation: from every entry file the modules that existed before are evaluated in the same order. |
| B11 | Nothing unexplained: every release is printed, every release is used. |
| B12 | Form: constructs a form does not support (accessor, generator, overload, `super`, `arguments`, `new.target`, `#private`, decorator, static method, reference to the class as a value, context name already in use, default value with an effect, a default value that reads `this` or can yield `undefined`, `this` as a type or as a value, `this` in a computed name or an `extends` clause of a nested class or member, a moved `let` or `var` that the rest assigns to). |
| B13 | Section lines: a line `// ── title ──` with the empty line before it may stay where it stood. |

## Release keys

| Key | Releases |
|---|---|
| `laden:<name>` | rule B9 for one moved declaration |
| `lesen:<name>` | rule B9, the rest reads this moved name while loading, in front of its old place |
| `ort:<line>:<column>` | rule B8 for one place of the OLD source file |
| `vorgabe:<method>.<parameter>` | rule B12, default value with an effect |
| `bindung:<line>:<column>` | rule B7, an identifier that cannot be resolved in both states |
| `reihenfolge:<entry>:<module>` | rule B10 for one module seen from one entry file |

## Layout

| File | Content |
|---|---|
| `verschiebung.ts` | command line |
| `beweis.ts` | the proof, limits of the proof |
| `manifest.ts`, `freigaben.ts` | manifest and releases (B11) |
| `stand.ts`, `programm.ts` | read access to both states, TypeScript program per state |
| `stuecke.ts`, `zerlegung.ts`, `importe.ts`, `abschnitt.ts` | pieces with their extents, partition (B1, B2), imports, section lines (B13) |
| `baum.ts`, `formk.ts` | tree comparison (B3), form k, unsupported constructs (B12) |
| `zweitlinie.ts` | second line (B4) |
| `klebstoff.ts`, `weiterleitung.ts`, `kontexttyp.ts` | glue (B5) |
| `kommentare.ts` | comments (B6) |
| `bindung.ts` | binding (B7) |
| `ort.ts`, `laden.ts` | location (B8), loading (B9) |
| `reihenfolge.ts` | order of evaluation (B10) |
| `syntaxphase.ts`, `semantikphase.ts` | the two phases of a run |
| `ausgabe.ts` | output as text and JSON |
| `pruefstand/` | test bench: a mover built independently of the proof (`verschieber.ts`), fixtures in memory (`probe.ts`, `vorlagen.ts`), probe on real files of a commit with the forgeries of both attacks (`echt.ts`, local only) |
| `zeugen/` | manifests of real steps (run locally, they need the git history) |

Self-tests: `tools/test/verschiebung-*.ts`, four files, in the CI: `regeln` (every rule bites, one green and one red fixture per rule), `altbestand` (the 151 fixtures of the earlier proof tool, transferred), `nachangriff` (the forgeries of both attacks on the earlier tool), `aufruf` (command line and the two states on a throwaway git repository). Probe on real files with the git history: `node_modules/.bin/tsx tools/verschiebung/pruefstand/echt.ts [--ref <commit>] [--nur <ids>] [--liste]`, under the build lock.

## What exit 0 does not prove

The list is part of every output (`GRENZEN` in `beweis.ts`). In short: nothing about files outside
the step, nothing about installed packages that changed between the states, the order of
evaluation only from the named entry files, and no behaviour is executed. The proof replaces
neither the type check nor the tests nor a review of the releases.
