import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findSourceCommit, GeneratorError, parseEngine, renderPage } from './generate-pack-reference.mjs';

const SCRIPT = fileURLToPath(new URL('./generate-pack-reference.mjs', import.meta.url));
const COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';

const VALIDATOR = `
export type Pack = {
  id: string;
  version: string;
  questions: Question[];
};

export const MAX_PACK_FILE_SIZE = 5 * 1024 * 1024;
const KNOWN_DIFFICULTIES = [1, 2, 3];
const MIN_CHOICES = 2;
const MAX_CHOICES = 6;
const MAX_QUESTIONS_PER_PACK = 1500;
const MAX_STRING_LENGTH = 2048;
const MAX_PROMPT_LENGTH = 5000;
const MAX_ID_LENGTH = 100;
const MAX_SCHEMA_VERSION = 1000;
const SAFE_ID_PATTERN = /^[a-z]+$/;
const RESERVED_PACK_IDS = new Set(["__proto__", "constructor"]);

export function validatePack(raw: unknown) {
  const p = raw as Record<string, unknown>;
  return {
    valid: true,
    pack: {
      id: p.id,
      version: isNonEmptyString(p.version) ? p.version : "0.0.0",
      questions: [],
    },
  };
}
`;

const QUESTIONS = `
import type { MultipleChoiceQuestion } from "@/components/question-modules/multiple-choice";
import type { TextAnswerQuestion } from "@/components/question-modules/text-answer";

type QuestionMeta = {
  category: string;
  difficulty: number;
};

export type Question =
  | (MultipleChoiceQuestion & QuestionMeta)
  | (TextAnswerQuestion & QuestionMeta);
`;

const MULTIPLE_CHOICE = `
export type MultipleChoiceQuestion = {
  id: string;
  type: "multiple-choice";
  choices: string[];
  language?: string;
};
`;

const TEXT_ANSWER = `
export type TextAnswerQuestion = {
  id: string;
  type: "text-answer";
  correctAnswer: string;
};
`;

const PACK = JSON.stringify({
  id: 'example',
  questions: [
    { id: 'one', type: 'multiple-choice' },
    { id: 'two', type: 'multiple-choice' },
    { id: 'three', type: 'text-answer' },
  ],
});

const FILES = {
  'src/data/validate-pack.ts': VALIDATOR,
  'src/data/questions.ts': QUESTIONS,
  'src/components/question-modules/multiple-choice.tsx': MULTIPLE_CHOICE,
  'src/components/question-modules/text-answer.tsx': TEXT_ANSWER,
  'packs/example.json': PACK,
};

const temporaryDirectories = [];

function createEngine(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'engine-fixture-'));
  temporaryDirectories.push(root);
  for (const [file, content] of Object.entries({ ...FILES, ...overrides })) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

function commitAll(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Fixture');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('parseEngine', () => {
  it('reads Pack fields and marks fields with a default as optional', () => {
    const fields = parseEngine(createEngine()).packFields;

    assert.deepEqual(
      fields.map(({ name, required }) => [name, required]),
      [
        ['id', true],
        ['version', false],
        ['questions', true],
      ],
    );
    assert.equal(fields[1].defaultValue, '"0.0.0"');
  });

  it('reads each question type with its own and shared fields', () => {
    const [multipleChoice, textAnswer] = parseEngine(createEngine()).questionTypes;

    assert.equal(multipleChoice.kind, 'multiple-choice');
    assert.deepEqual(
      multipleChoice.fields.map(({ name }) => name),
      ['id', 'type', 'choices', 'language', 'category', 'difficulty'],
    );
    assert.equal(multipleChoice.fields.find(({ name }) => name === 'language').required, false);
    assert.equal(textAnswer.kind, 'text-answer');
  });

  it('reads limits with their real values', () => {
    const { limits, difficulties, packIdPattern, reservedPackIds } = parseEngine(createEngine());
    const values = Object.fromEntries(limits.map(({ name, value }) => [name, value]));

    assert.equal(values.MAX_PACK_FILE_SIZE, 5242880);
    assert.equal(values.MAX_CHOICES, 6);
    assert.deepEqual(difficulties, [1, 2, 3]);
    assert.equal(packIdPattern, '/^[a-z]+$/');
    assert.deepEqual(reservedPackIds, ['__proto__', 'constructor']);
  });

  it('includes a limit it has no label for', () => {
    const root = createEngine({
      'src/data/validate-pack.ts': `${VALIDATOR}\nconst MAX_CATEGORIES = 12;\n`,
    });

    const limit = parseEngine(root).limits.find(({ name }) => name === 'MAX_CATEGORIES');
    assert.equal(limit.value, 12);
    assert.equal(limit.label, '`MAX_CATEGORIES`');
  });

  it('uses the first question of each type as the example', () => {
    const { example } = parseEngine(createEngine());

    assert.equal(example.file, 'packs/example.json');
    assert.deepEqual(
      example.pack.questions.map(({ id }) => id),
      ['one', 'three'],
    );
  });
});

describe('missing symbols', () => {
  const removals = [
    ['the Pack type', 'src/data/validate-pack.ts', 'export type Pack =', 'export type Bundle =', /type Pack was not found/],
    ['validatePack', 'src/data/validate-pack.ts', 'function validatePack', 'function checkPack', /function validatePack was not found/],
    ['the returned pack', 'src/data/validate-pack.ts', 'pack: {', 'bundle: {', /no longer returns a pack object/],
    ['a required limit', 'src/data/validate-pack.ts', 'const MAX_CHOICES', 'const CHOICE_LIMIT', /constant MAX_CHOICES was not found/],
    ['KNOWN_DIFFICULTIES', 'src/data/validate-pack.ts', 'KNOWN_DIFFICULTIES', 'DIFFICULTIES', /constant KNOWN_DIFFICULTIES was not found/],
    ['SAFE_ID_PATTERN', 'src/data/validate-pack.ts', 'SAFE_ID_PATTERN', 'ID_PATTERN', /constant SAFE_ID_PATTERN was not found/],
    ['RESERVED_PACK_IDS', 'src/data/validate-pack.ts', 'RESERVED_PACK_IDS', 'RESERVED', /constant RESERVED_PACK_IDS was not found/],
    ['QuestionMeta', 'src/data/questions.ts', 'type QuestionMeta =', 'type Meta =', /type QuestionMeta was not found/],
    ['the Question type', 'src/data/questions.ts', 'export type Question =', 'export type Item =', /type Question was not found/],
    ['a question type', 'src/components/question-modules/text-answer.tsx', 'export type TextAnswerQuestion', 'export type FreeText', /type TextAnswerQuestion was not found/],
  ];

  for (const [label, file, from, to, message] of removals) {
    it(`fails clearly when ${label} is renamed`, () => {
      const root = createEngine({ [file]: FILES[file].replaceAll(from, to) });
      assert.throws(() => parseEngine(root), (error) => {
        assert.ok(error instanceof GeneratorError);
        assert.match(error.message, message);
        return true;
      });
    });
  }

  it('fails clearly when a source file is missing', () => {
    const root = createEngine({ 'src/data/validate-pack.ts': null });
    assert.throws(() => parseEngine(root), /src\/data\/validate-pack\.ts was not found/);
  });

  it('fails clearly when a limit is not a readable number', () => {
    const root = createEngine({
      'src/data/validate-pack.ts': VALIDATOR.replace('const MAX_CHOICES = 6', 'const MAX_CHOICES = getLimit()'),
    });
    assert.throws(() => parseEngine(root), /MAX_CHOICES .* is not a number the generator can read/);
  });

  it('fails clearly when no example exists for a question type', () => {
    const root = createEngine({
      'packs/example.json': JSON.stringify({ questions: [{ id: 'one', type: 'multiple-choice' }] }),
    });
    assert.throws(() => parseEngine(root), /has no text-answer question/);
  });
});

describe('renderPage', () => {
  it('gives identical output for the same input', () => {
    const root = createEngine();
    assert.equal(renderPage(parseEngine(root), COMMIT), renderPage(parseEngine(root), COMMIT));
  });

  it('marks the page as generated, with the commit', () => {
    const page = renderPage(parseEngine(createEngine()), COMMIT);

    assert.match(page, /^---\ntitle: Pack format reference\n/);
    assert.match(page, /audience: pack-author/);
    assert.ok(page.includes(`tree/${COMMIT}`));
    assert.match(page, /Don't edit it by hand/);
  });

  it('shows fields and limits', () => {
    const page = renderPage(parseEngine(createEngine()), COMMIT);

    assert.match(page, /\| `version` \| `string` \| No \| `"0\.0\.0"` \|/);
    assert.match(page, /\| `id` \| `string` \| Yes \| — \|/);
    assert.match(page, /\| Most `choices` \| 6 \|/);
    assert.match(page, /\| Largest pack file, in bytes \| 5,242,880 \(5 MB\) \|/);
    assert.match(page, /### `text-answer`/);
  });
});

describe('findSourceCommit', () => {
  it('fails clearly outside a git checkout', () => {
    assert.throws(() => findSourceCommit(createEngine(), ['packs/example.json']), /not a git checkout/);
  });
});

describe('command line', () => {
  function run(root, output) {
    return spawnSync('node', [SCRIPT, root, '--output', output], { encoding: 'utf8' });
  }

  it('writes the page, and running twice gives identical output', () => {
    const root = createEngine();
    commitAll(root);
    const output = join(root, 'page.mdx');

    assert.equal(run(root, output).status, 0);
    const first = readFileSync(output, 'utf8');
    assert.equal(run(root, output).status, 0);
    assert.equal(readFileSync(output, 'utf8'), first);
  });

  it('exits non-zero with a message and leaves the existing page untouched', () => {
    const root = createEngine({ 'src/data/questions.ts': null });
    const output = join(root, 'page.mdx');
    writeFileSync(output, 'existing page');

    const result = run(root, output);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Error: src\/data\/questions\.ts was not found/);
    assert.equal(readFileSync(output, 'utf8'), 'existing page');
  });

  it('exits non-zero when the engine checkout does not exist', () => {
    const result = run(join(tmpdir(), 'no-such-engine'), join(tmpdir(), 'unused.mdx'));

    assert.equal(result.status, 1);
    assert.match(result.stderr, /no engine checkout at/);
    assert.equal(existsSync(join(tmpdir(), 'unused.mdx')), false);
  });
});
