import Link from 'next/link';
import { appName } from '@/lib/shared';

const sections = [
  {
    title: 'Getting started',
    description: 'What the app does and how to run it locally.',
    href: '/docs/getting-started',
  },
  {
    title: 'Pack authoring',
    description: 'Write a question pack that passes validation.',
    href: '/docs/pack-authoring',
  },
  {
    title: 'Reference',
    description: 'Settings, and what the app stores on your device.',
    href: '/docs/reference/settings',
  },
  {
    title: 'Architecture',
    description: 'How the app is built, for contributors.',
    href: '/docs/architecture',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-4 py-12">
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-fd-muted-foreground" lang="ja">
          守 破 離
        </p>
        <h1 className="text-3xl font-bold sm:text-4xl">{appName}</h1>
        <p className="text-lg text-fd-muted-foreground">
          Shu Ha Ri Engine is a mobile app for practising the fundamentals of a subject, one
          question pack at a time. No accounts, no streaks, and no trophies.
        </p>
      </div>

      <nav aria-label="Documentation sections" className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-lg border bg-fd-card p-4 text-fd-card-foreground transition-colors hover:bg-fd-accent"
          >
            <h2 className="font-semibold">{section.title}</h2>
            <p className="mt-1 text-sm text-fd-muted-foreground">{section.description}</p>
          </Link>
        ))}
      </nav>
    </main>
  );
}
