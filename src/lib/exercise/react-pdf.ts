// Lazy loader for @react-pdf/renderer. Server only.
//
// The package is ESM only. A static import breaks under tsx, which runs
// server.ts as CommonJS and loads the package through require (its
// @react-pdf/hyphenate dependency then fails with ERR_PACKAGE_PATH_NOT_EXPORTED).
// A native import() works everywhere: tsx, vitest and the Next server bundle,
// where webpackIgnore keeps webpack from turning it into a require.
//
// PDF modules import the primitives and the render helper from here, never
// from the package itself (type imports are fine).

import { createElement, type ComponentProps } from "react";
import type * as ReactPdf from "@react-pdf/renderer";

export type ReactPdfModule = typeof ReactPdf;
export type Style = Parameters<ReactPdfModule["StyleSheet"]["create"]>[0][string];

let loaded: ReactPdfModule | null = null;
let loading: Promise<ReactPdfModule> | null = null;

/** Load @react-pdf/renderer once per process. */
export function loadReactPdf(): Promise<ReactPdfModule> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import(/* webpackIgnore: true */ "@react-pdf/renderer")
    .then((m: ReactPdfModule & { default?: ReactPdfModule }) => {
      loaded = typeof m.renderToBuffer === "function" ? m : (m.default ?? m);
      return loaded;
    })
    .catch((err: unknown) => {
      loading = null;
      throw err;
    });
  return loading;
}

function mod(): ReactPdfModule {
  if (!loaded) throw new Error("@react-pdf/renderer is not loaded. Render through renderPdf().");
  return loaded;
}

/** Same as StyleSheet.create, which is an identity function in v4. */
export function styles<T extends Record<string, Style>>(x: T): T {
  return x;
}

type DocumentProps = ComponentProps<ReactPdfModule["Document"]>;
type PageProps = ComponentProps<ReactPdfModule["Page"]>;
type TextProps = ComponentProps<ReactPdfModule["Text"]>;
type ViewProps = ComponentProps<ReactPdfModule["View"]>;

// Thin wrappers that resolve the real primitive at render time.
export function Document(props: DocumentProps) {
  return createElement(mod().Document, props);
}
export function Page(props: PageProps) {
  return createElement(mod().Page, props);
}
export function Text(props: TextProps) {
  return createElement(mod().Text, props);
}
export function View(props: ViewProps) {
  return createElement(mod().View, props);
}

/** Render a <Document> element to a PDF buffer. */
export async function renderPdf(element: Parameters<ReactPdfModule["renderToBuffer"]>[0]): Promise<Buffer> {
  const rp = await loadReactPdf();
  return rp.renderToBuffer(element);
}
