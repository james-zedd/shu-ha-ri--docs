# Shu Ha Ri Engine Docs

Documentation site for [Shu Ha Ri Engine](https://github.com/james-zedd/shu-ha-ri--engine), a mobile app for learning through question packs.

Built with [Next.js](https://nextjs.org/docs) and [Fumadocs](https://fumadocs.dev), and exported as a fully static site.

## Run locally

Requires Node 22 and npm.

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

Pages are MDX files in `content/docs/`.
