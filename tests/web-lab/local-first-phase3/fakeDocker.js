"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test fixture loaded by the contract harness. */

const fs = require("node:fs");

class FakeDocker {
  constructor(imageDigest, architecture = "arm64") {
    this.imageDigest = imageDigest;
    this.architecture = architecture;
    this.containers = new Map();
    this.networks = new Map();
    this.volumes = new Map();
    this.commands = [];
    this.copiedBundleModes = [];
    this.fail = null;
    this.nextPort = 49152;
  }

  labels(args) {
    const labels = {};
    for (let index = 0; index < args.length; index++) {
      if (args[index] !== "--label") continue;
      const [name, ...rest] = args[index + 1].split("=");
      labels[name] = rest.join("=");
      index++;
    }
    return labels;
  }

  name(args) { return args[args.indexOf("--name") + 1]; }
  shouldFail(args) {
    if (!this.fail) return false;
    const prefix = args.slice(0, this.fail.args.length);
    if (prefix.join("\0") !== this.fail.args.join("\0")) return false;
    if (this.fail.once) this.fail = null;
    return true;
  }

  async execute(command, args) {
    if (command !== "/usr/bin/docker") throw new Error("unexpected executable");
    this.commands.push([...args]);
    if (this.shouldFail(args)) throw new Error("synthetic docker failure");
    if (args[0] === "image" && args[1] === "inspect") {
      if (args[2] !== this.imageDigest) throw new Error("image missing");
      return JSON.stringify([{ Id: this.imageDigest, Os: "linux", Architecture: this.architecture }]);
    }
    if (args[0] === "network" && args[1] === "create") {
      const name = args.at(-1);
      const id = `net-${name}`;
      this.networks.set(id, { Id: id, Name: name, Labels: this.labels(args), Internal: args.includes("--internal") });
      return id;
    }
    if (args[0] === "volume" && args[1] === "create") {
      const name = args.at(-1);
      this.volumes.set(name, { Name: name, Labels: this.labels(args) });
      return name;
    }
    if (args[0] === "create") {
      const name = this.name(args);
      const id = `ctr-${name}`;
      this.containers.set(id, { Id: id, Name: name, Config: { Labels: this.labels(args) }, State: { Running: false }, Args: [...args] });
      return id;
    }
    if (args[0] === "cp") {
      const source = args[1].replace(/\/\.$/, "");
      this.copiedBundleModes = fs.readdirSync(source).map(name => fs.statSync(`${source}/${name}`).mode & 0o777);
      return "";
    }
    if (args[0] === "network" && args[1] === "connect") return "";
    if (args[0] === "start") {
      const item = [...this.containers.values()].find(value => value.Name === args[1] || value.Id === args[1]);
      if (!item) throw new Error("container missing");
      item.State.Running = true;
      return item.Id;
    }
    if (args[0] === "port") return `192.168.63.2:${this.nextPort}`;
    if (args[0] === "container" && args[1] === "ls") {
      return [...this.containers.values()].filter(value => value.Config.Labels["com.amniora.runtime-helper.managed"] === "true")
        .map(value => value.Id).join("\n");
    }
    if (args[0] === "network" && args[1] === "ls") {
      return [...this.networks.values()].filter(value => value.Labels["com.amniora.runtime-helper.managed"] === "true")
        .map(value => value.Id).join("\n");
    }
    if (args[0] === "volume" && args[1] === "ls") {
      return [...this.volumes.values()].filter(value => value.Labels["com.amniora.runtime-helper.managed"] === "true")
        .map(value => value.Name).join("\n");
    }
    if (args[0] === "inspect") return JSON.stringify(args.slice(1).map(id => this.containers.get(id)).filter(Boolean));
    if (args[0] === "network" && args[1] === "inspect") {
      return JSON.stringify(args.slice(2).map(id => this.networks.get(id)).filter(Boolean));
    }
    if (args[0] === "volume" && args[1] === "inspect") {
      return JSON.stringify(args.slice(2).map(name => this.volumes.get(name)).filter(Boolean));
    }
    if (args[0] === "rm" && args[1] === "-f") {
      const item = [...this.containers.entries()].find(([id, value]) => id === args[2] || value.Name === args[2]);
      if (item) this.containers.delete(item[0]);
      return args[2];
    }
    if (args[0] === "network" && args[1] === "rm") { this.networks.delete(args[2]); return args[2]; }
    if (args[0] === "volume" && args[1] === "rm") { this.volumes.delete(args[2]); return args[2]; }
    throw new Error(`unexpected docker operation: ${args.slice(0, 3).join(" ")}`);
  }

  stopAllForReboot() {
    for (const container of this.containers.values()) container.State.Running = false;
  }

  addUnrelated() {
    this.containers.set("unrelated", { Id: "unrelated", Name: "unrelated", Config: { Labels: {} }, State: { Running: true }, Args: [] });
    this.networks.set("unrelated-network", { Id: "unrelated-network", Name: "unrelated-network", Labels: {}, Internal: false });
    this.volumes.set("unrelated-volume", { Name: "unrelated-volume", Labels: {} });
  }

  addFakeManaged(labels = {}) {
    this.containers.set("fake-managed", { Id: "fake-managed", Name: "fake-managed", Config: { Labels: {
      "com.amniora.runtime-helper.managed": "true",
      "com.amniora.runtime-helper.helper-protocol": "1.0",
      "com.amniora.runtime-helper.role": "challenge",
      "com.amniora.runtime-helper.runtime-id": "f".repeat(32),
      "com.amniora.runtime-helper.build-id": "fake-build-id",
      "com.amniora.runtime-helper.build-fingerprint": "f".repeat(64),
      "com.amniora.runtime-helper.package-hash": "f".repeat(64),
      "com.amniora.runtime-helper.generation": "1",
      ...labels,
    } }, State: { Running: true }, Args: [] });
  }
}

module.exports = { FakeDocker };
