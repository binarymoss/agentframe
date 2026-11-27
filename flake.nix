{
  description = "AgentFrame";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      browser = "${pkgs.chromium}/bin/chromium";
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
    in {
      packages.${system} = { inherit agentframe; default = agentframe; };
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
