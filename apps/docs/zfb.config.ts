import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

export default defineConfig(
  zudoDoc({
    siteName: "Vector Image Detection",
    siteDescription: "Vector-based image search and tagging tools.",
    siteUrl: "https://doc-vector-image-detection.takazudomodular.com",
    githubUrl: "https://github.com/Takazudo/vector-image-detection",
    sitemap: true,
    colorScheme: "Default Dark",
    colorMode: {
      defaultMode: "dark",
      lightScheme: "Default Light",
      darkScheme: "Default Dark",
      respectPrefersColorScheme: true,
    },
    defaultLocale: "ja",
    cjkFriendly: true,
    llmsTxt: true,
    sidebarResizer: true,
    sidebarToggle: true,
    tocToggle: true,
    imageEnlarge: true,
    dynamicPageTransition: true,
    claudeResources: {
      claudeDir: ".claude",
    },
    defaultLocaleOnlyPrefixes: [
      "/docs/claude-md/",
      "/docs/claude-skills/",
      "/docs/claude-agents/",
      "/docs/claude-commands/",
    ],
    footer: {
      links: [],
      copyright: "Copyright © 2026 Vector Image Detection.",
    },
    headerNav: [
      { label: "概要", path: "/docs/overview", categoryMatch: "overview" },
      { label: "はじめる", path: "/docs/getting-started", categoryMatch: "getting-started" },
      { label: "仕組み", path: "/docs/concepts", categoryMatch: "concepts" },
      { label: "使い方", path: "/docs/guides", categoryMatch: "guides" },
      { label: "リファレンス", path: "/docs/reference", categoryMatch: "reference" },
    ],
    headerRightItems: [
      { type: "component", component: "github-link" },
      { type: "component", component: "theme-toggle" },
      { type: "component", component: "search" },
    ],
  }),
);
