/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { routeContext } from "virtual:zudo-doc-route-context";
import { createRouteContext, type RouteContextPayload } from "@takazudo/zudo-doc/route-context";
import { createChrome } from "@takazudo/zudo-doc/chrome";
import { chromeBindings } from "virtual:zudo-doc-chrome-bindings";

const ctx = routeContext as unknown as RouteContextPayload;
const routeCtx = createRouteContext(ctx);
const { renderDocPage } = createChrome(routeCtx, chromeBindings);

export const frontmatter = { title: "Docs" };

export function paths(): Array<{ params: { slug: string[] }; props: unknown }> {
  const locale = routeCtx.defaultLocale;
  const source = routeCtx.resolveNavSource(locale, undefined);
  return routeCtx
    .buildDocRouteEntries({
      source,
      locale,
      routeSig: `docs;${locale}`,
    })
    .map((item) => ({
      params: { slug: item.slugParams },
      props: item.props,
    }));
}

type PageArgs = { params: { slug: string[] } } & Record<string, unknown>;

export default function DocsPage(props: PageArgs): JSX.Element {
  return renderDocPage(props as never, {
    locale: routeCtx.defaultLocale,
    docHistoryContentDir: routeCtx.settings.docsDir,
  });
}
