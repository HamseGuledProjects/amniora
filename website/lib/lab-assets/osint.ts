import { buildBaseAssets } from "./base";
import type { AssetPackInput, LabAsset } from "./types";

export function buildOsintAssets(input: AssetPackInput): LabAsset[] {
  const base = buildBaseAssets(input);
  const advanced = input.difficulty === "Advanced";

  const assets: LabAsset[] = [
    {
      file_name: "company_homepage.html",
      file_type: "html",
      file_path: "assets/osint/company_homepage.html",
      content: `<html>
<head><title>Northstar Fabrication Ltd</title></head>
<body>
<h1>Northstar Fabrication Ltd</h1>
<p>Industrial parts supplier based in Birmingham.</p>
<p>Contact: info@northstar-fab.example</p>
<p>Careers: We are hiring cloud engineers with AWS and Terraform experience.</p>
</body>
</html>
`,
    },
    {
      file_name: "employees.csv",
      file_type: "csv",
      file_path: "assets/osint/employees.csv",
      content: `name,role,public_email
Amir Khan,IT Manager,amir.khan@northstar-fab.example
Sarah Jones,Cloud Engineer,sarah.jones@northstar-fab.example
Musa Ali,Operations Lead,musa.ali@northstar-fab.example
`,
    },
    {
      file_name: "dns_records.txt",
      file_type: "text",
      file_path: "assets/osint/dns_records.txt",
      content: `www.northstar-fab.example A 203.0.113.20
mail.northstar-fab.example A 203.0.113.25
vpn.northstar-fab.example A 203.0.113.30
`,
    },
    {
      file_name: "robots.txt",
      file_type: "text",
      file_path: "assets/osint/robots.txt",
      content: `User-agent: *
Disallow: /admin
Disallow: /internal
Disallow: /old-careers
`,
    },
  ];

  if (advanced) {
    assets.push(
      {
        file_name: "press_release.txt",
        file_type: "text",
        file_path: "assets/osint/press_release.txt",
        content: `Northstar Fabrication Ltd announces a new supplier portal pilot.

The pilot will support remote partner access and will be managed by the cloud infrastructure team.

Public contact: suppliers@northstar-fab.example
`,
      },
      {
        file_name: "job_posting.txt",
        file_type: "text",
        file_path: "assets/osint/job_posting.txt",
        content: `Role: Cloud Infrastructure Engineer

Required:
- AWS
- Terraform
- Linux administration
- VPN troubleshooting
- CI/CD experience

Location: Birmingham hybrid
`,
      },
      {
        file_name: "email_patterns.txt",
        file_type: "text",
        file_path: "assets/osint/email_patterns.txt",
        content: `Observed email pattern:
firstname.lastname@northstar-fab.example

Examples:
amir.khan@northstar-fab.example
sarah.jones@northstar-fab.example
musa.ali@northstar-fab.example
`,
      }
    );
  }

  return [...base, ...assets];
}