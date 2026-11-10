# Third-party notices

Amniora's original work is licensed under the [MIT License](LICENSE). Third-party dependencies and assets retain their own licences and notices, as summarised below.

Third-party package contents, native binaries and fonts are not vendored in this edition. `npm ci` and .NET restore obtain the dependencies declared in the lockfiles and project files. Those packages retain their licence files and notices. The website also retains the original Next.js scaffold SVGs, including Next.js and Vercel marks; these remain the property of their respective owners and do not imply endorsement.

The Amniora mark and repository preview are existing project brand artwork, reused at the owner's request. They show the project identity only. They are not product screenshots or evidence of a released service. The MIT licence for original work also applies to this brand artwork.

| Dependency or platform | Use in this edition | Notice |
| --- | --- | --- |
| TypeScript 5.9.3 | Offline source loading and type checking | Apache-2.0. The installed package includes `LICENSE.txt` and `ThirdPartyNoticeText.txt`. |
| `@types/node` 20.19.43 | Node.js type declarations | MIT; copyright Microsoft Corporation, as recorded in the installed package's `LICENSE`. |
| `undici-types` | Transitive type dependency pinned by `package-lock.json` | MIT; its installed package retains its `LICENSE`. |
| Node.js | Runtime and built-in standard library | Supplied separately by the developer. Its distribution retains its own third-party notices. |
| .NET 8 | Native Windows project compilation and the optional Windows policy test | Supplied separately. The root policy harness has no NuGet package dependencies. |
| `NSec.Cryptography` 24.4.0 | Windows Ed25519 identity implementation | MIT, copyright Klaus Hartke. The package's `NOTICE` also preserves the ISC notice for libsodium, copyright Frank Denis. Neither package binaries nor private keys are committed. |
| `System.Security.Cryptography.ProtectedData` 8.0.0 | Windows DPAPI wrapper | Microsoft .NET package, MIT. No stored identities or product-state files are included. |
| `Microsoft.Web.WebView2` 1.0.4258.31 | Native Windows lab viewer | Its restored package includes Microsoft's `LICENSE.txt` and `NOTICE.txt`; retain both when distributing any resulting application. No WebView2 binaries are committed here. |
| Apple AppKit, Foundation, CryptoKit, Security and WebKit | Imported by complete macOS source and selected excerpts | Supplied by the macOS SDK, not redistributed here. |

## Website and shared service dependencies

The full website and Runner source retain their genuine SDK imports. Local demonstration adapters disable external service calls; retaining a dependency does not mean that a hosted integration has been provisioned.

| Dependency | Role | Licence recorded in the package |
| --- | --- | --- |
| Next.js 16.4.6 and eslint-config-next 16.4.6 | Website framework and framework lint rules | MIT |
| React and React DOM 19.2.4 | Website interface | MIT |
| `@supabase/ssr` and `@supabase/supabase-js` | Original authentication and database adapters | MIT |
| `@sentry/nextjs` 10.75.2 | Retained monitoring/privacy implementation; startup is disabled in the local demonstration | MIT |
| `@vercel/sandbox` | Retained hosted-runtime adapter source | Apache-2.0 |
| `postgres` | Original Postgres repository adapters | Unlicense |
| GSAP and `@gsap/react` | Website motion and React integration | [GSAP standard licence](https://gsap.com/standard-license), as identified by their package metadata |
| `framer-motion` | Website animation | MIT |
| `lucide-react` | Interface icons | ISC |
| Tailwind CSS and `@tailwindcss/postcss` | Website styling | MIT |
| ESLint, React type declarations and Supabase CLI | Development dependencies | MIT |
| `server-only` | Server-module boundary marker in the Runner source dependency closure | MIT |

Exact transitive versions are recorded in the three `package-lock.json` files. The package licence declarations and installed TypeScript/Node type notices were inspected. Native NSec and WebView2 licence/notice files were also inspected during compile validation. Building a distributable application would require a separate review of all transitive runtime notices; this repository distributes source, not those built applications.

Genuine dependency names, cryptographic type names, product AI terminology and required third-party notices remain.
