{
  description = "The open-source video editor for coding agents: create from scratch or edit existing footage";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      browser = "${pkgs.chromium}/bin/chromium";
      biomeFiles = "src test package.json tsconfig.json";
      formatFiles = "${biomeFiles} AGENTS.md README.md skills";
      biomeFormat = "${pkgs.biome}/bin/biome format --indent-style=space --md-formatter-enabled=true";
      agentframe = pkgs.stdenvNoCC.mkDerivation {
        pname = "agentframe";
        version = "0.1.0";
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [ ./src ./skills ./package.json ./pnpm-lock.yaml ];
        };
        nativeBuildInputs = with pkgs; [ nodejs_26 pnpm pnpmConfigHook makeWrapper ];
        pnpmDeps = pkgs.fetchPnpmDeps {
          inherit (agentframe) pname version src;
          inherit (pkgs) pnpm;
          fetcherVersion = 4;
          hash = "sha256-yhiSmUc4JNHYjPR9fPD22NKp/P432lZ7NOEjN681zYI=";
        };
        dontBuild = true;
        installPhase = ''
          runHook preInstall
          mkdir -p "$out/lib/agentframe" "$out/bin"
          cp -r src package.json node_modules "$out/lib/agentframe/"
          install -Dm644 skills/agentframe/SKILL.md "$out/share/agentframe/skills/agentframe/SKILL.md"
          makeWrapper ${pkgs.nodejs_26}/bin/node "$out/bin/agentframe" \
            --add-flags "$out/lib/agentframe/src/cli.ts" \
            --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.ffmpeg ]} \
            --set AGENTFRAME_BROWSER_PATH ${browser}
          runHook postInstall
        '';
        meta.mainProgram = "agentframe";
      };
      lint = pkgs.runCommand "agentframe-lint" {
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [ ./src ./test ./package.json ./tsconfig.json ./AGENTS.md ./README.md ./skills ];
        };
      } ''
        cd "$src"
        ${biomeFormat} ${formatFiles}
        ${pkgs.biome}/bin/biome lint ${biomeFiles}
        touch "$out"
      '';
      tests = agentframe.overrideAttrs (old: {
        pname = "agentframe-tests";
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [ ./src ./test ./package.json ./pnpm-lock.yaml ];
        };
        nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.ffmpeg ];
        AGENTFRAME_BROWSER_PATH = browser;
        doCheck = true;
        checkPhase = ''
          runHook preCheck
          pnpm test
          runHook postCheck
        '';
        installPhase = "touch \"$out\"";
      });
    in {
      packages.${system} = { inherit agentframe; default = agentframe; };
      formatter.${system} = pkgs.writeShellScriptBin "agentframe-format" ''
        if [ "$#" -eq 0 ]; then
          set -- ${formatFiles}
        fi
        exec ${biomeFormat} --write "$@"
      '';
      checks.${system} = { inherit lint tests; };
      apps.${system}.agentframe = {
        type = "app";
        program = "${agentframe}/bin/agentframe";
      };
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ nodejs_26 pnpm ffmpeg chromium ];
        AGENTFRAME_BROWSER_PATH = browser;
      };
    };
}
