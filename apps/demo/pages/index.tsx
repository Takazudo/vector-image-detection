import { Island } from "@takazudo/zfb";
import { App } from "../src/App";

export default function DemoPage() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="description"
          content="Local image vector search demo: search photos by description, auto-categorize by words, and attach your own tags."
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <title>Photo vector search — demo</title>
      </head>
      <body>
        {/* zfb's marker is transformed before React runs; its intentionally
            opaque IslandElement is not structurally a React 19 ReactNode. */}
        {/* @ts-expect-error zfb IslandElement is a build marker, not runtime JSX output */}
        <Island
          ssrFallback={
            <main className="grid min-h-screen place-items-center px-md py-lg">
              <p className="text-muted">Loading the index bundle&hellip;</p>
            </main>
          }
        >
          <App />
        </Island>
      </body>
    </html>
  );
}
