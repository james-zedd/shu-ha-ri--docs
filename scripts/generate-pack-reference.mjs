// Generates the Pack format reference from the engine's source code.
//
// Usage: node scripts/generate-pack-reference.mjs [engine-path] [--output <file>]
//
// The sources are parsed with the TypeScript compiler API. If an expected symbol
// is missing, the script exits non-zero before anything is written.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ENGINE_REPO = 'https://github.com/james-zedd/shu-ha-ri--engine';
const DEFAULT_ENGINE_PATH = '../shu-ha-ri--engine';
const DEFAULT_OUTPUT = fileURLToPath(
  new URL('../content/docs/reference/pack-format.mdx', import.meta.url),
);

const VALIDATOR_FILE = 'src/data/validate-pack.ts';
const QUESTIONS_FILE = 'src/data/questions.ts';
const PACKS_DIRECTORY = 'packs';

// Limits are found by their MAX_ or MIN_ prefix, so a new limit still appears
// on the page. These are the ones the page has to have, with readable labels.
const LIMIT_LABELS = {
  MAX_PACK_FILE_SIZE: 'Largest pack file, in bytes',
  MAX_QUESTIONS_PER_PACK: 'Most questions in a pack',
  MAX_ID_LENGTH: 'Longest pack or question `id`',
  MAX_PROMPT_LENGTH: 'Longest `prompt`',
  MAX_STRING_LENGTH: 'Longest value for any other text field',
  MIN_CHOICES: 'Fewest `choices`',
  MAX_CHOICES: 'Most `choices`',
  MAX_SCHEMA_VERSION: 'Highest `schemaVersion`',
};

export class GeneratorError extends Error {}

function fail(message) {
  throw new GeneratorError(message);
}

function loadSource(root, file) {
  const path = join(root, file);
  if (!existsSync(path)) fail(`${file} was not found in the engine checkout`);

  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind);
}

function findTypeAlias(source, name) {
  const node = source.statements.find(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  );
  if (!node) fail(`type ${name} was not found in ${source.fileName}`);
  return node;
}

function readFields(source, name) {
  const { type } = findTypeAlias(source, name);
  if (!ts.isTypeLiteralNode(type)) fail(`type ${name} in ${source.fileName} is not an object type`);

  return type.members.map((member) => {
    if (!ts.isPropertySignature(member) || !member.type) {
      fail(`type ${name} in ${source.fileName} has a member that isn't a plain field`);
    }
    return {
      name: member.name.getText(source),
      type: member.type.getText(source),
      required: !member.questionToken,
      defaultValue: null,
    };
  });
}

function findConstants(source) {
  const constants = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        constants.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return constants;
}

function requireConstant(constants, name, source) {
  const value = constants.get(name);
  if (!value) fail(`constant ${name} was not found in ${source.fileName}`);
  return value;
}

function evaluateNumber(node, name, source) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isParenthesizedExpression(node)) return evaluateNumber(node.expression, name, source);
  if (ts.isBinaryExpression(node)) {
    const left = evaluateNumber(node.left, name, source);
    const right = evaluateNumber(node.right, name, source);
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
    if (node.operatorToken.kind === ts.SyntaxKind.MinusToken) return left - right;
  }
  return fail(`constant ${name} in ${source.fileName} is not a number the generator can read`);
}

function readLimits(constants, source) {
  for (const name of Object.keys(LIMIT_LABELS)) requireConstant(constants, name, source);

  return [...constants.entries()]
    .filter(([name]) => /^(MAX|MIN)_/.test(name))
    .map(([name, node]) => ({
      name,
      label: LIMIT_LABELS[name] ?? `\`${name}\``,
      value: evaluateNumber(node, name, source),
    }));
}

function readNumberArray(constants, name, source) {
  const node = requireConstant(constants, name, source);
  if (!ts.isArrayLiteralExpression(node)) fail(`constant ${name} in ${source.fileName} is not an array`);
  return node.elements.map((element) => evaluateNumber(element, name, source));
}

function readPattern(constants, name, source) {
  const node = requireConstant(constants, name, source);
  if (!ts.isRegularExpressionLiteral(node)) fail(`constant ${name} in ${source.fileName} is not a regular expression`);
  return node.text;
}

function readStringSet(constants, name, source) {
  const node = requireConstant(constants, name, source);
  const items = ts.isNewExpression(node) ? node.arguments?.[0] : undefined;
  if (!items || !ts.isArrayLiteralExpression(items)) {
    fail(`constant ${name} in ${source.fileName} is not a Set of strings`);
  }
  return items.elements.map((element) => {
    if (!ts.isStringLiteral(element)) fail(`constant ${name} in ${source.fileName} contains a value that isn't a string`);
    return element.text;
  });
}

function findDescendant(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => findDescendant(child, predicate));
}

// The Pack type marks every field as required, but validatePack fills in some of
// them with a conditional, such as `version: isNonEmptyString(p.version) ? ... : "0.0.0"`.
function readPackDefaults(source) {
  const validatePack = source.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'validatePack',
  );
  if (!validatePack) fail(`function validatePack was not found in ${source.fileName}`);

  const assignment = findDescendant(
    validatePack,
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'pack' &&
      ts.isObjectLiteralExpression(node.initializer),
  );
  if (!assignment) fail(`validatePack in ${source.fileName} no longer returns a pack object`);

  const defaults = new Map();
  for (const property of assignment.initializer.properties) {
    if (ts.isPropertyAssignment(property) && ts.isConditionalExpression(property.initializer)) {
      defaults.set(property.name.getText(source), property.initializer.whenFalse.getText(source));
    }
  }
  return defaults;
}

function readPackFields(source) {
  const defaults = readPackDefaults(source);
  return readFields(source, 'Pack').map((field) =>
    defaults.has(field.name)
      ? { ...field, required: false, defaultValue: defaults.get(field.name) }
      : field,
  );
}

function resolveImport(root, specifier, source) {
  if (!specifier.startsWith('@/')) fail(`${source.fileName} imports ${specifier} from an unexpected path`);

  const base = `src/${specifier.slice(2)}`;
  const file = [`${base}.tsx`, `${base}.ts`].find((candidate) => existsSync(join(root, candidate)));
  if (!file) fail(`${specifier}, imported by ${source.fileName}, was not found in the engine checkout`);
  return file;
}

function findImport(source, name) {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named) && named.elements.some((element) => element.name.text === name)) {
      return statement.moduleSpecifier.text;
    }
  }
  return fail(`the import for ${name} was not found in ${source.fileName}`);
}

function readQuestionTypes(root, source) {
  const metaFields = readFields(source, 'QuestionMeta');
  const { type: union } = findTypeAlias(source, 'Question');
  if (!ts.isUnionTypeNode(union)) fail(`type Question in ${source.fileName} is not a union`);

  return union.types.map((member) => {
    const intersection = ts.isParenthesizedTypeNode(member) ? member.type : member;
    const parts = ts.isIntersectionTypeNode(intersection) ? intersection.types : [intersection];
    const names = parts.map((part) => part.getText(source)).filter((name) => name !== 'QuestionMeta');
    if (names.length !== 1) fail(`type Question in ${source.fileName} has a member the generator can't read`);

    const [typeName] = names;
    const file = resolveImport(root, findImport(source, typeName), source);
    const fields = readFields(loadSource(root, file), typeName);
    const kindField = fields.find((field) => field.name === 'type');
    if (!kindField || !/^"[^"]+"$/.test(kindField.type)) {
      fail(`type ${typeName} in ${file} has no literal \`type\` field`);
    }

    return { kind: kindField.type.slice(1, -1), file, fields: [...fields, ...metaFields] };
  });
}

function readExample(root, questionTypes) {
  const directory = join(root, PACKS_DIRECTORY);
  if (!existsSync(directory)) fail(`${PACKS_DIRECTORY} was not found in the engine checkout`);

  const [name] = readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort();
  if (!name) fail(`${PACKS_DIRECTORY} contains no example packs`);

  const file = `${PACKS_DIRECTORY}/${name}`;
  let pack;
  try {
    pack = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    fail(`${file} is not valid JSON`);
  }

  const questions = questionTypes.map(({ kind }) => {
    const question = pack.questions?.find((candidate) => candidate.type === kind);
    if (!question) fail(`${file} has no ${kind} question to use as an example`);
    return question;
  });

  return { file, pack: { ...pack, questions } };
}

export function parseEngine(root) {
  const validator = loadSource(root, VALIDATOR_FILE);
  const questions = loadSource(root, QUESTIONS_FILE);
  const constants = findConstants(validator);

  const questionTypes = readQuestionTypes(root, questions);
  const example = readExample(root, questionTypes);

  return {
    packFields: readPackFields(validator),
    questionTypes,
    limits: readLimits(constants, validator),
    difficulties: readNumberArray(constants, 'KNOWN_DIFFICULTIES', validator),
    packIdPattern: readPattern(constants, 'SAFE_ID_PATTERN', validator),
    reservedPackIds: readStringSet(constants, 'RESERVED_PACK_IDS', validator),
    example,
    sources: [VALIDATOR_FILE, QUESTIONS_FILE, ...questionTypes.map(({ file }) => file), example.file],
  };
}

function fieldTable(fields) {
  const rows = fields.map(({ name, type, required, defaultValue }) => {
    const defaultCell = defaultValue === null ? '—' : `\`${defaultValue}\``;
    return `| \`${name}\` | \`${type.replaceAll('|', '\\|')}\` | ${required ? 'Yes' : 'No'} | ${defaultCell} |`;
  });
  return ['| Field | Type | Required | Default |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function formatLimit(value) {
  const text = value.toLocaleString('en-US');
  return value >= 1024 * 1024 ? `${text} (${value / (1024 * 1024)} MB)` : text;
}

export function renderPage(engine, commit) {
  const { packFields, questionTypes, limits, difficulties, packIdPattern, reservedPackIds, example } = engine;
  const shortCommit = commit.slice(0, 7);

  const typeSections = questionTypes.flatMap(({ kind, fields }) => [
    `### \`${kind}\``,
    fieldTable(fields),
  ]);

  const limitRows = limits.map(({ label, value }) => `| ${label} | ${formatLimit(value)} |`);

  const frontmatter = [
    '---',
    'title: Pack format reference',
    'description: Every field and limit in the question pack format, generated from the engine source.',
    'audience: pack-author',
    '---',
  ].join('\n');

  return `${[
    frontmatter,
    `> This page is generated from [engine commit \`${shortCommit}\`](${ENGINE_REPO}/tree/${commit}). Don't edit it by hand. To update it, run \`npm run generate:reference\`.`,
    'For a walkthrough, see [Write a question pack](/docs/pack-authoring).',
    '## Pack fields',
    fieldTable(packFields),
    `A pack \`id\` must match \`${packIdPattern}\`, and it can't be any of these: ${reservedPackIds.map((id) => `\`${id}\``).join(', ')}.`,
    '## Question fields',
    `The app supports ${questionTypes.length} question types. A question with any other \`type\` is skipped.`,
    ...typeSections,
    `\`difficulty\` must be one of ${difficulties.map((value) => `\`${value}\``).join(', ')}.`,
    '## Limits',
    ['| Limit | Value |', '| --- | --- |', ...limitRows].join('\n'),
    '## Example',
    `These questions come from \`${example.file}\` in the engine repo, with one question of each type.`,
    `\`\`\`json\n${JSON.stringify(example.pack, null, 2)}\n\`\`\``,
  ].join('\n\n')}\n`;
}

// The commit that last changed a parsed file, not HEAD, so an unrelated engine
// commit doesn't change this page.
export function findSourceCommit(root, sources) {
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  let commit;
  try {
    if (git('rev-parse', '--is-shallow-repository') === 'true') {
      fail(`${root} is a shallow clone. The generator needs the full history to find the source commit.`);
    }
    commit = git('log', '-1', '--format=%H', '--', ...sources);
  } catch (error) {
    if (error instanceof GeneratorError) throw error;
    fail(`${root} is not a git checkout of the engine repo`);
  }
  if (!commit) fail(`no commit in ${root} contains the parsed source files`);
  return commit;
}

function parseArguments(args) {
  const options = { root: DEFAULT_ENGINE_PATH, output: DEFAULT_OUTPUT };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output') {
      index += 1;
      if (!args[index]) fail('--output needs a file path');
      options.output = args[index];
    } else {
      options.root = args[index];
    }
  }
  return options;
}

export function main(args) {
  const { root, output } = parseArguments(args);
  const engineRoot = resolve(root);
  if (!existsSync(engineRoot)) {
    fail(`no engine checkout at ${engineRoot}. Clone ${ENGINE_REPO} there, or pass its path as an argument.`);
  }

  const engine = parseEngine(engineRoot);
  const page = renderPage(engine, findSourceCommit(engineRoot, engine.sources));

  // Write to a temporary file first, so a failed write can't leave a partial page.
  const temporaryFile = join(dirname(output), `.pack-format-${process.pid}.tmp`);
  writeFileSync(temporaryFile, page);
  renameSync(temporaryFile, output);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Wrote ${main(process.argv.slice(2))}`);
  } catch (error) {
    if (!(error instanceof GeneratorError)) throw error;
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
