<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/agentframe@0.1.0/assets/wordmark-white.svg">
    <img src="https://cdn.jsdelivr.net/npm/agentframe@0.1.0/assets/wordmark-black.svg" width="360" alt="AgentFrame">
  </picture>
</p>

<p align="center">
  <a href="#install"><img src="https://img.shields.io/badge/platform-Linux-85c5fa?style=for-the-badge&amp;labelColor=0D1117&amp;logo=linux&amp;logoColor=white" alt="Platform: Linux"></a>
  <a href="#install"><img src="https://img.shields.io/badge/Node.js-26%2B-9dce8f?style=for-the-badge&amp;labelColor=0D1117&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 26 or newer"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-9cbeff?style=for-the-badge&amp;labelColor=0D1117" alt="License: GPL-3.0"></a>
</p>

<p align="center"><strong>The open-source video editor for coding agents: create from scratch or edit existing footage</strong></p>

<p align="center">Plain HTML and just a CLI. Simple is better</p>

## Install

### Debian-, Fedora-, and Arch-based distros

```bash
curl -fsSL https://raw.githubusercontent.com/binarymoss/agentframe/main/install.sh | bash
```

The script installs AgentFrame and any missing dependencies: Node.js 26+, FFmpeg, FFprobe, and Chromium.

To use a specific browser, set `AGENTFRAME_BROWSER_PATH` to its executable path.

The installer also copies the skill to `~/.agents/skills/agentframe`. For Claude Code, use `| bash -s -- --claude` instead.

### Nix

Add AgentFrame to your flake inputs. Here's an example for NixOS.

#### Add the input

In `flake.nix`:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    agentframe.url = "github:binarymoss/agentframe";
  };

  outputs = { nixpkgs, ... }@inputs: {
    nixosConfigurations.hostname = nixpkgs.lib.nixosSystem {
      specialArgs = { inherit inputs; };
      # For Home Manager, use home-manager.extraSpecialArgs instead.
      modules = [ ./configuration.nix ];
    };
  };
}
```

#### Add the package

In `configuration.nix`:

```nix
{ inputs, pkgs, ... }:

{
  environment.systemPackages = [
    # Or use home.packages for Home Manager.
    inputs.agentframe.packages.${pkgs.stdenv.hostPlatform.system}.default
  ];
}
```

#### Install the skill

```bash
curl -fsSL https://raw.githubusercontent.com/binarymoss/agentframe/main/install.sh | bash -s -- --skill-only
```

For Claude Code, add `--claude` after `--skill-only`.

Then just ask your agent to create whatever you want!
