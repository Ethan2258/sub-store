import vue from "@vitejs/plugin-vue";
import * as path from "path";
import fs from "fs";
import { ConfigEnv, defineConfig, loadEnv, type HtmlTagDescriptor, type Plugin, type Rollup } from "vite";
import { createStyleImportPlugin } from "vite-plugin-style-import";
import { createSvgIconsPlugin } from "vite-plugin-svg-icons";
import viteCompression from "vite-plugin-compression";
import { VitePWA } from "vite-plugin-pwa";

const version = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")).version.trim();
// Release builds get the release tag (e.g. 2.34.0-31) from CI; local builds
// fall back to the package version.
const buildTagEnv = (process.env.SUB_STORE_BUILD_TAG || "").trim();
const buildTag = /^[0-9A-Za-z][0-9A-Za-z.-]{0,63}$/.test(buildTagEnv) ? buildTagEnv : version;

// No component compiles a template at runtime, so the default runtime-only
// Vue build is enough and the template compiler stays out of the bundle.
const alias = [
  { find: "@", replacement: path.resolve(__dirname, "src") },
  // The package's module entry is a webpack UMD build with core-js polyfills
  // bundled in; its ES module source is the same component without them.
  { find: /^vuedraggable$/, replacement: "vuedraggable/src/vuedraggable.js" },
];

// Strips comments and spacing from the inline styles of index.html (the
// loading placeholder). The backend cannot send its .gz copy when the page is
// requested as `/`, so this is what most first visits download.
const minifyInlineStyles = (html: string) =>
  html.replace(/<style>([\s\S]*?)<\/style>/g, (_, css: string) => {
    const minified = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([{};:,>])\s*/g, "$1")
      .replace(/;}/g, "}")
      .trim();
    return `<style>${minified}</style>`;
  });

const htmlPlugin = () => {
  return {
    name: "html-transform",
    transformIndexHtml(html: string) {
      return minifyInlineStyles(html.replace(/__SUB_STORE_FRONT_END_VERSION__/g, version));
    },
  };
};

// splash.ts starts the app with a dynamic import, so Vite does not list the
// app's files in index.html and the browser only learns about them after the
// entry script has downloaded and run. List the app chunk, the chunks it
// imports and its styles there, so they download alongside the entry script.
const preloadAppPlugin = (): Plugin => {
  let base = "/";
  return {
    name: "preload-app",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const app = Object.values(bundle).find(
          (file): file is Rollup.OutputChunk =>
            file.type === "chunk" && file.moduleIds.some((id) => id.endsWith("/src/main.ts")),
        );
        if (!app) return html;

        const chunks = new Set<string>();
        const styles = new Set<string>();
        const visit = (fileName: string) => {
          const chunk = bundle[fileName];
          if (chunks.has(fileName) || chunk?.type !== "chunk" || chunk.isEntry) return;
          chunks.add(fileName);
          chunk.viteMetadata?.importedCss.forEach((css) => styles.add(css));
          chunk.imports.forEach(visit);
        };
        visit(app.fileName);

        const tags: HtmlTagDescriptor[] = [
          ...[...chunks].map((file) => ({
            tag: "link",
            attrs: { rel: "modulepreload", crossorigin: true, href: base + file },
            injectTo: "head" as const,
          })),
          // Vite adds the stylesheet later with crossorigin; the preload must
          // match it or the browser downloads the file twice.
          ...[...styles].map((file) => ({
            tag: "link",
            attrs: { rel: "preload", as: "style", crossorigin: true, href: base + file },
            injectTo: "head" as const,
          })),
        ];
        // The app also waits for the messages of the current language, which
        // splash.ts only requests once it runs. Start that download here too,
        // choosing the language as locales/languages.ts does (default zh).
        const localeFiles: Record<string, string> = {};
        Object.values(bundle).forEach((file) => {
          if (file.type !== "chunk") return;
          const locale = file.moduleIds
            .map((id) => /\/src\/locales\/(?!index|languages|loaders)(\w+)\.ts$/.exec(id)?.[1])
            .find(Boolean);
          if (locale) localeFiles[locale] = base + file.fileName;
        });
        if (Object.keys(localeFiles).length > 0) {
          tags.push({
            tag: "script",
            children: `(function(){try{var m=${JSON.stringify(localeFiles)},l=(localStorage.getItem("locale")||navigator.language||"").toLowerCase().split(/[-_]/)[0],h=m[l]||m.zh;if(h){var e=document.createElement("link");e.rel="modulepreload";e.crossOrigin="";e.href=h;document.head.appendChild(e)}}catch(e){}})()`,
            injectTo: "head",
          });
        }
        return { html, tags };
      },
    },
  };
};

const viteConfig = defineConfig((mode: ConfigEnv) => {
  const env = loadEnv(mode.mode, process.cwd());

  return {
    plugins: [
      htmlPlugin(),
      preloadAppPlugin(),
      vue(),
      createStyleImportPlugin({
        // resolves: [NutuiResolve()],
        libs: [
          {
            libraryName: "@nutui/nutui",
            esModule: true,
            resolveStyle: (name) => {
              name = name.toLowerCase().replace("-", ""); // NutuiResolve官方版目前在linux会造成大小写不一致问题无法加载资源
              if (name === "icon") {
                return "";
              }
              return `@nutui/nutui/dist/packages/${name}/index.scss`;
            },
          },
        ],
      }),
      createSvgIconsPlugin({
        iconDirs: [path.resolve(process.cwd(), "src/assets/icons")],
        symbolId: "icon-[dir]-[name]",
        customDomId: "__svg__icons__dom__",
      }),
      // The Sub-Store backend sends `<file>.gz` with Content-Encoding: gzip
      // when the browser accepts it, so every file worth compressing gets one,
      // including the small entry script the first page waits for.
      viteCompression({
        verbose: false,
        threshold: 1024,
        compressionOptions: { level: 9 },
      }),
      VitePWA({
        srcDir: "src",
        outDir: "dist",
        strategies: "generateSW",
        registerType: "prompt",
        // minify: true,
        // includeAssets: ['favicon.svg'],
        manifest: {
          name: "Sub-Store",
          short_name: "Sub-Store",
          description: "A sub-converter running in a Progressive Web App",
          id: "/",
          start_url: "/",
          scope: "/",
          lang: "en",
          display: "standalone",
          icons: [
            {
              src: "144x144.png",
              sizes: "144x144",
              type: "image/png",
            },
            {
              src: "168x168.png",
              sizes: "168x168",
              type: "image/png",
            },
            {
              src: "192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "256x256.png",
              sizes: "256x256",
              type: "image/png",
            },
            {
              src: "512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,json}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/(^|\/.+)\/(api|download|share)\/.+/],
          runtimeCaching: [
            {
              urlPattern: ({ url, request }) => request.destination === "script" && url.origin === self.location.origin,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "js-cache",
              },
            },
            {
              urlPattern: ({ request }) => request.destination === "style" || request.destination === "image" || request.destination === "font",
              handler: "CacheFirst",
              options: {
                cacheName: "asset-cache",
              },
            },
          ],
        },
        selfDestroying: false,
      }),
    ],
    root: process.cwd(),
    resolve: { alias },
    optimizeDeps: {
      include: ["@codemirror/lang-yaml"],
    },
    base: mode.command === "serve" ? "./" : env.VITE_PUBLIC_PATH,
    hmr: true,
    server: {
      port: env.VITE_PORT as unknown as number,
      open: env.VITE_OPEN,
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      assetsInlineLimit: 2048,
      chunkSizeWarningLimit: 2048,
      target: "es2015",
      minify: "terser",
      rollupOptions: {
        output: {
          // The Sub-Store backend caches files named `-<8 hex digits>.<ext>`
          // for a year (immutable) and makes the browser revalidate anything
          // else on every visit. Rollup's default hashes use letters too.
          hashCharacters: "hex",
          entryFileNames: "[name]-[hash].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            const ext = assetInfo.name?.split(".").pop()?.toLowerCase() ?? "";
            if (/^(png|jpe?g|svg|webp|avif|gif|ico)$/.test(ext)) return "images/[name]-[hash].[ext]";
            if (/^(woff2?|ttf|eot|otf)$/.test(ext)) return "fonts/[name]-[hash].[ext]";
            if (ext === "css") return "css/[name]-[hash].[ext]";
            return "[name]-[hash].[ext]";
          },
          manualChunks(id) {
            // Rollup's CommonJS interop helper is shared by the first page and
            // by lazy chunks. Keep it in the vendor chunk, or it can land in a
            // lazy chunk (e.g. the editor) that the first page then imports.
            if (id.includes("commonjsHelpers")) return "vue-vendor";
            if (id.includes("node_modules")) {
              if (id.includes("@nutui/nutui") || (id.includes("@nutui") && !id.includes("@nutui/icons"))) return "nutui";
              if (id.includes("/codemirror/") || id.includes("@codemirror/") || id.includes("@lezer/") || id.includes("@replit/codemirror") || id.includes("js-beautify")) return "editor";
              if (id.includes("vue-i18n") || id.includes("@intlify/")) return "i18n";
              if (id.includes("@fortawesome/")) return "icons";
              if (id.includes("@vuepic/vue-datepicker")) return "datepicker";
              // @vueuse/integrations is left out so the QR code library it
              // pulls in is only downloaded by the pages that show a QR code.
              if (id.includes("/vue/") || id.includes("/vue-router/") || id.includes("/pinia/") || id.includes("@vue/") || id.includes("@vueuse/core") || id.includes("@vueuse/shared")) return "vue-vendor";
            }
          },
        },
      },
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: "modern-compiler",
          // 配置 自定义覆盖主题 和 nutui 全局 scss 变量
          additionalData: `@import "@/assets/styles/custom_variables.scss";@import "@nutui/nutui/dist/styles/variables-jdt.scss";@import '@/assets/styles/mixins.scss';`,
          // NutUI 3 和 Vite 3 仍依赖 Sass 已弃用的 API。
          silenceDeprecations: ["import", "legacy-js-api"],
        },
      },
    },
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false,
      "import.meta.env.PACKAGE_VERSION": JSON.stringify(version),
      "import.meta.env.BUILD_TAG": JSON.stringify(buildTag),
    },
  };
});

export default viteConfig;
