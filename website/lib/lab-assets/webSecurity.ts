import { buildBaseAssets } from "./base";
import type { AssetPackInput, LabAsset } from "./types";

export function buildWebSecurityAssets(input: AssetPackInput): LabAsset[] {
  const base = buildBaseAssets(input);
  const advanced = input.difficulty === "Advanced";

  const assets: LabAsset[] = [
    {
      file_name: "access.log",
      file_type: "log",
      file_path: "assets/logs/access.log",
      content: `192.168.56.10 - - [06/Jul/2026:10:12:01] "GET / HTTP/1.1" 200
192.168.56.23 - - [06/Jul/2026:10:14:44] "GET /admin HTTP/1.1" 403
192.168.56.23 - - [06/Jul/2026:10:15:12] "GET /backup.zip HTTP/1.1" 404
192.168.56.10 - - [06/Jul/2026:10:18:20] "POST /login HTTP/1.1" 302
`,
    },
    {
      file_name: "headers.txt",
      file_type: "text",
      file_path: "assets/web/headers.txt",
      content: `Server: nginx
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Content-Security-Policy: missing
Strict-Transport-Security: missing
`,
    },
    {
      file_name: "robots.txt",
      file_type: "text",
      file_path: "assets/web/robots.txt",
      content: `User-agent: *
Disallow: /admin
Disallow: /backups
`,
    },
    {
      file_name: "login_page.html",
      file_type: "html",
      file_path: "assets/web/login_page.html",
      content: `<form method="POST" action="/login">
  <input name="email" type="email" />
  <input name="password" type="password" />
  <button type="submit">Login</button>
</form>
`,
    },
  ];

  if (advanced) {
    assets.push(
      {
        file_name: "error.log",
        file_type: "log",
        file_path: "assets/logs/error.log",
        content: `[06/Jul/2026:10:15:12] 404 /backup.zip
[06/Jul/2026:10:17:43] warning: missing Content-Security-Policy header
[06/Jul/2026:10:21:04] notice: repeated requests to /admin from 192.168.56.23
`,
      },
      {
        file_name: "cookies.txt",
        file_type: "text",
        file_path: "assets/web/cookies.txt",
        content: `sessionid=abc123; HttpOnly; SameSite=Lax
theme=dark
debug=true
`,
      },
      {
        file_name: "site_map.xml",
        file_type: "xml",
        file_path: "assets/web/site_map.xml",
        content: `<urlset>
  <url><loc>https://lab.local/</loc></url>
  <url><loc>https://lab.local/login</loc></url>
  <url><loc>https://lab.local/admin</loc></url>
  <url><loc>https://lab.local/backups</loc></url>
</urlset>
`,
      }
    );
  }

  return [...base, ...assets];
}
