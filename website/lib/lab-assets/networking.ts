import { buildBaseAssets } from "./base";
import type { AssetPackInput, LabAsset } from "./types";

export function buildNetworkingAssets(input: AssetPackInput): LabAsset[] {
  const base = buildBaseAssets(input);
  const advanced = input.difficulty === "Advanced";

  const assets: LabAsset[] = [
    {
      file_name: "routes.txt",
      file_type: "text",
      file_path: "assets/network/routes.txt",
      content: `Destination     Gateway         Genmask         Interface
0.0.0.0         192.168.56.1    0.0.0.0         eth0
192.168.56.0    0.0.0.0         255.255.255.0   eth0
10.10.20.0      192.168.56.254  255.255.255.0   eth0
`,
    },
    {
      file_name: "firewall_rules.conf",
      file_type: "config",
      file_path: "assets/network/firewall_rules.conf",
      content: `ALLOW tcp 22 from 192.168.56.0/24
ALLOW tcp 80 from any
DENY tcp 3306 from any
ALLOW icmp from 192.168.56.0/24
`,
    },
    {
      file_name: "dns_records.txt",
      file_type: "text",
      file_path: "assets/network/dns_records.txt",
      content: `intranet.lab.local A 192.168.56.20
files.lab.local A 192.168.56.30
dev.lab.local A 10.10.20.15
`,
    },
    {
      file_name: "ping_results.txt",
      file_type: "text",
      file_path: "assets/network/ping_results.txt",
      content: `PING intranet.lab.local (192.168.56.20): success
PING files.lab.local (192.168.56.30): success
PING dev.lab.local (10.10.20.15): failed - destination unreachable
`,
    },
  ];

  if (advanced) {
    assets.push(
      {
        file_name: "traceroute.txt",
        file_type: "text",
        file_path: "assets/network/traceroute.txt",
        content: `traceroute to dev.lab.local (10.10.20.15)
1  192.168.56.1
2  192.168.56.254
3  * * *
`,
      },
      {
        file_name: "change_ticket.md",
        file_type: "markdown",
        file_path: "assets/network/change_ticket.md",
        content: `# Change Ticket CHG-1042

## Summary
Add development subnet access for internal lab users.

## Planned Change
- Add route to 10.10.20.0/24 through 192.168.56.254
- Allow required service access to dev.lab.local
- Validate DNS resolution after change

## Reported Issue
Users can resolve dev.lab.local but cannot reach the service after the change window.
`,
      },
      {
        file_name: "arp_table.txt",
        file_type: "text",
        file_path: "assets/network/arp_table.txt",
        content: `Address          HWtype  HWaddress           Iface
192.168.56.1     ether   08:00:27:aa:bb:01   eth0
192.168.56.254   ether   08:00:27:aa:bb:fe   eth0
192.168.56.30    ether   08:00:27:aa:bb:30   eth0
`,
      }
    );
  }

  return [...base, ...assets];
}