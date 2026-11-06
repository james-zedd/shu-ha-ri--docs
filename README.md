# Shu Ha Ri Engine Docs

Documentation site for [Shu Ha Ri Engine](https://github.com/james-zedd/shu-ha-ri--engine), a mobile app for learning through question packs.

Built with [Next.js](https://nextjs.org/docs) and [Fumadocs](https://fumadocs.dev), and exported as a fully static site.

## Run locally

Requires Node 24 and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> to see the site.

## Commands

| Command                | Description                                |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start the development server.              |
| `npm run build`        | Build the static site into `out/`.         |
| `npm start`            | Serve the built site from `out/`.          |
| `npm run lint`         | Run ESLint.                                |
| `npm run types:check`  | Generate route types and check TypeScript. |
| `npm run lint:content` | Check Markdown formatting.                 |
| `npm test`             | Run the script tests.                      |

## Writing content

Pages are MDX files in `content/docs/`. Each page starts with frontmatter, which is checked by the schema in `lib/source.ts`. If a page has a missing or invalid field, `npm run build` fails.

| Field         | Required | Value                                                        |
| ------------- | -------- | ------------------------------------------------------------ |
| `title`       | Yes      | The page title.                                              |
| `description` | Yes      | A one-sentence summary. It can't be empty.                   |
| `audience`    | Yes      | Who the page is for: `user`, `pack-author` or `contributor`. |

```yaml
---
title: Write a question pack
description: Build a question pack that passes the app's validation.
audience: pack-author
---
```

## Generated pages

`content/docs/reference/pack-format.mdx` is generated from the engine's source, so don't edit it by hand. To update it, you need a local clone of the [engine repo](https://github.com/james-zedd/shu-ha-ri--engine) with its full history.

```bash
git clone https://github.com/james-zedd/shu-ha-ri--engine.git ../shu-ha-ri--engine
npm run generate:reference
```

To use a clone somewhere else, pass its path: `npm run generate:reference -- path/to/engine`.

## Check your writing

`npm run lint:content` runs the same check as a pull request. It uses [markdownlint](https://github.com/DavidAnson/markdownlint-cli2) to check Markdown formatting, with the settings in `.markdownlint-cli2.jsonc`. Any issue fails the pull request.

Pull requests also check every internal and external link, including heading anchors, using [lychee](https://lychee.cli.rs). This only runs in CI, so there's nothing to install. If an external link is a known false positive, add it to `exclude` in `lychee.toml`.
