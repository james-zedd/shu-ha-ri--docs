# Shu Ha Ri Engine Docs

Documentation site for [Shu Ha Ri Engine](https://github.com/james-zedd/shu-ha-ri--engine), a mobile app for learning through question packs.

Built with [Next.js](https://nextjs.org/docs) and [Fumadocs](https://fumadocs.dev), and exported as a fully static site.

## Run locally

Requires Node 24 and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000 to see the site.

## Commands

| Command               | Description                                |
| --------------------- | ------------------------------------------ |
| `npm run dev`         | Start the development server.              |
| `npm run build`       | Build the static site into `out/`.         |
| `npm start`           | Serve the built site from `out/`.          |
| `npm run lint`        | Run ESLint.                                |
| `npm run types:check` | Generate route types and check TypeScript. |

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
