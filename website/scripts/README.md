# Website scripts

`portfolio-next.cjs` starts or builds the local portfolio configuration. Use the commands in the [website README](../README.md).

`local-runner.cjs`, `byo-runner.cjs` and `runner-distribution/` preserve historical Runner entry points and packaging implementation. They are not called by the local demo scripts. They require separate runtime or signing configuration and may launch processes, use network services or write installation/build output. They were not executed for this portfolio.

The original production provisioning script is excluded because it configures live controls and credentials. No original environment file or private service configuration is included.
